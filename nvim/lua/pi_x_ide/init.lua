local M = {}

local state = {
  config = nil,
  job_id = nil,
  timer = nil,
  augroup = nil,
  latest_snapshot = nil,
  visual_mark_valid = false,
}

local defaults = {
  enabled = true,
  sidecar_cmd = nil,
  debounce_ms = 150,
  range_format = "comma",
  keymap = nil,
  workspace_folders = nil,
}

local function notify(message, level)
  vim.notify("Pi x IDE: " .. message, level or vim.log.levels.INFO)
end

local function plugin_root()
  local source = debug.getinfo(1, "S").source
  if source:sub(1, 1) == "@" then
    source = source:sub(2)
  end
  return vim.fn.fnamemodify(source, ":p:h:h:h")
end

local function platform_target()
  local uname = vim.loop.os_uname()
  local sys = uname.sysname:lower()
  local mach = uname.machine:lower()

  local arch
  if mach == "x86_64" or mach == "amd64" then
    arch = "x64"
  elseif mach == "aarch64" or mach == "arm64" then
    arch = "arm64"
  end
  if not arch then
    return nil
  end

  if sys == "linux" then
    return "linux-" .. arch
  elseif sys == "darwin" then
    return "darwin-" .. arch
  elseif sys:find("windows") then
    return "windows-" .. arch .. ".exe"
  end
  return nil
end

local function sidecar_binary_name()
  local target = platform_target()
  if not target then
    return nil
  end
  return "pi-x-ide-nvim-sidecar-" .. target
end

local function cache_paths(name)
  local cache_dir = vim.fn.stdpath("cache") .. "/pi-x-ide"
  local dest = cache_dir .. "/" .. name
  return cache_dir, dest, dest .. ".verified"
end

local function download_path(dest)
  if dest:sub(-4) == ".exe" then
    return dest:sub(1, -5) .. ".download.exe"
  end
  return dest .. ".download"
end

local function ensure_executable(path)
  if path:sub(-4) == ".exe" then
    return true
  end

  local stat = vim.loop.fs_stat(path)
  if not stat then
    return false
  end

  if bit.band(stat.mode, 64) == 0 then -- missing owner x bit
    vim.loop.fs_chmod(path, bit.bor(stat.mode, 73)) -- add u+x,g+x,o+x
  end

  local updated = vim.loop.fs_stat(path)
  return updated ~= nil and bit.band(updated.mode, 64) ~= 0
end

local marker_version = "sha256-v1"
local release_api_url = "https://api.github.com/repos/balaenis/pi-x-ide/releases/latest"

local function verification_token(path)
  local stat = vim.loop.fs_stat(path)
  if not stat then
    return nil
  end
  local mtime = stat.mtime and stat.mtime.sec or 0
  return tostring(stat.size) .. ":" .. tostring(mtime)
end

local function normalize_sha256_digest(digest)
  if type(digest) ~= "string" then
    return nil
  end

  local hex = digest:match("^sha256:([0-9a-fA-F]+)$") or digest:match("^([0-9a-fA-F]+)$")
  if not hex or #hex ~= 64 then
    return nil
  end
  return hex:lower()
end

local function marker_matches(path, marker)
  local token = verification_token(path)
  if not token then
    return false
  end

  local ok, lines = pcall(vim.fn.readfile, marker)
  if not ok or type(lines) ~= "table" then
    return false
  end

  return lines[1] == marker_version and normalize_sha256_digest(lines[2]) ~= nil and lines[3] == token
end

local function write_marker(path, marker, digest)
  local token = verification_token(path)
  local sha256 = normalize_sha256_digest(digest)
  if not token or not sha256 then
    return false
  end

  local ok = pcall(vim.fn.writefile, { marker_version, "sha256:" .. sha256, token }, marker)
  return ok
end

local function sha256_command(path)
  if vim.fn.executable("sha256sum") == 1 then
    return { "sha256sum", path }
  elseif vim.fn.executable("shasum") == 1 then
    return { "shasum", "-a", "256", path }
  elseif vim.fn.executable("certutil") == 1 then
    return { "certutil", "-hashfile", path, "SHA256" }
  end
  return nil
end

local function file_sha256(path)
  local command = sha256_command(path)
  if not command then
    return nil, "no SHA256 tool found"
  end

  local output = vim.fn.system(command)
  if vim.v.shell_error ~= 0 then
    return nil, "SHA256 tool failed"
  end

  for candidate in tostring(output):gmatch("%x+") do
    if #candidate == 64 then
      return candidate:lower()
    end
  end
  return nil, "SHA256 tool output did not contain a digest"
end

local function decode_json(data)
  if vim.json and vim.json.decode then
    return vim.json.decode(data)
  end
  return vim.fn.json_decode(data)
end

local function http_get_command(url)
  if vim.fn.executable("curl") == 1 then
    return {
      "curl",
      "-fsSL",
      "--retry",
      "3",
      "--retry-delay",
      "5",
      "-H",
      "Accept: application/vnd.github+json",
      "-H",
      "X-GitHub-Api-Version: 2022-11-28",
      "-H",
      "User-Agent: pi-x-ide-nvim",
      url,
    }
  elseif vim.fn.executable("wget") == 1 then
    return {
      "wget",
      "-q",
      "--tries=3",
      "-O",
      "-",
      "--header=Accept: application/vnd.github+json",
      "--header=X-GitHub-Api-Version: 2022-11-28",
      "--header=User-Agent: pi-x-ide-nvim",
      url,
    }
  end
  return nil
end

local function download_command(url, path)
  if vim.fn.executable("curl") == 1 then
    return { "curl", "-fsSL", "--retry", "3", "--retry-delay", "5", "-C", "-", "-o", path, url }
  elseif vim.fn.executable("wget") == 1 then
    return { "wget", "-q", "--tries=3", "--continue", "-O", path, url }
  end
  return nil
end

local function find_release_asset(payload, name)
  if type(payload) ~= "table" or type(payload.assets) ~= "table" then
    return nil, "release metadata did not include assets"
  end

  for _, asset in ipairs(payload.assets) do
    if type(asset) == "table" and asset.name == name then
      local sha256 = normalize_sha256_digest(asset.digest)
      if not sha256 then
        return nil, "release asset is missing a SHA256 digest"
      end
      if type(asset.browser_download_url) ~= "string" or asset.browser_download_url == "" then
        return nil, "release asset is missing a download URL"
      end
      return { url = asset.browser_download_url, sha256 = sha256 }, nil
    end
  end

  return nil, "release asset not found for " .. name
end

local function fetch_release_asset(name, on_done)
  local tool = http_get_command(release_api_url)
  if not tool then
    return nil
  end

  local stdout_lines = {}
  local stderr_lines = {}
  local job_id = vim.fn.jobstart(tool, {
    stdout_buffered = true,
    stderr_buffered = true,
    on_stdout = function(_, data)
      for _, line in ipairs(data or {}) do
        table.insert(stdout_lines, line)
      end
    end,
    on_stderr = function(_, data)
      for _, line in ipairs(data or {}) do
        if line ~= "" then
          table.insert(stderr_lines, line)
        end
      end
    end,
    on_exit = function(_, code)
      vim.schedule(function()
        if code ~= 0 then
          local detail = table.concat(stderr_lines, " ")
          on_done(nil, "release metadata fetch failed (exit=" .. tostring(code) .. ")" .. (detail ~= "" and " — " .. detail or ""))
          return
        end

        local ok, payload = pcall(decode_json, table.concat(stdout_lines, "\n"))
        if not ok then
          on_done(nil, "release metadata was not valid JSON")
          return
        end

        local asset, err = find_release_asset(payload, name)
        on_done(asset, err)
      end)
    end,
  })

  return job_id > 0
end

local verify_sidecar_binary

local function verify_downloaded_sidecar(path, expected_sha256)
  local actual_sha256, sha256_err = file_sha256(path)
  if not actual_sha256 then
    return false, sha256_err
  end
  if actual_sha256 ~= expected_sha256 then
    return false, "SHA256 mismatch"
  end
  if not verify_sidecar_binary(path) then
    return false, "binary self-check failed"
  end
  return true, nil
end

verify_sidecar_binary = function(path)
  if not vim.loop.fs_stat(path) then
    return false
  end
  if not ensure_executable(path) then
    return false
  end

  local output = vim.fn.system({ path, "--help" })
  return vim.v.shell_error == 0
    and type(output) == "string"
    and output:find("Usage: pi%-x%-ide%-nvim%-sidecar", 1) ~= nil
end

local function resolve_sidecar_binary()
  local name = sidecar_binary_name()
  if not name then
    return nil
  end

  -- 1. Bundled with the plugin (npm / manual install)
  local bundled = plugin_root() .. "/bin/" .. name
  if vim.loop.fs_stat(bundled) then
    ensure_executable(bundled)
    return bundled
  end

  -- 2. Previously downloaded to cache. Only trust files that have a
  -- checksum marker written after a successful GitHub Release digest match.
  -- Older cache entries are deleted and re-downloaded with SHA256 verification.
  local _, cached, marker = cache_paths(name)
  if marker_matches(cached, marker) then
    ensure_executable(cached)
    return cached
  end
  if vim.loop.fs_stat(cached) then
    os.remove(cached)
    os.remove(marker)
  end

  return nil
end

local function default_sidecar_cmd()
  local binary = resolve_sidecar_binary()
  if binary then
    ensure_executable(binary)
    return { binary }
  end
  return { "node", plugin_root() .. "/bin/pi-x-ide-nvim-sidecar.cjs" }
end

local function cache_downloaded_sidecar(tmp, dest, marker, expected_sha256)
  local verified, verify_err = verify_downloaded_sidecar(tmp, expected_sha256)
  if not verified then
    os.remove(tmp)
    os.remove(marker)
    notify("Sidecar binary download failed SHA256 verification" .. (verify_err and (" — " .. verify_err) or "") .. " — deleted; will retry next restart", vim.log.levels.WARN)
    return
  end

  os.remove(dest)
  os.remove(marker)
  local ok, rename_err = vim.loop.fs_rename(tmp, dest)
  if ok and write_marker(dest, marker, expected_sha256) then
    notify("Sidecar binary ready (restart Neovim to use it)", vim.log.levels.INFO)
  else
    os.remove(tmp)
    os.remove(dest)
    os.remove(marker)
    notify("Sidecar binary download could not be cached" .. (rename_err and (" — " .. rename_err) or "") .. " — will retry next restart", vim.log.levels.WARN)
  end
end

local function download_sidecar_asset(asset, dest, marker)
  local tmp = download_path(dest)
  if not sha256_command(tmp) then
    notify("Sidecar binary download requires sha256sum, shasum, or certutil for verification — will keep using Node.js fallback", vim.log.levels.WARN)
    return
  end

  local tool = download_command(asset.url, tmp)
  if not tool then
    return
  end

  notify("Downloading sidecar binary (one-time, ~91MB)  ...", vim.log.levels.INFO)

  local stderr_lines = {}
  local job_id = vim.fn.jobstart(tool, {
    stderr_buffered = true,
    on_stderr = function(_, data)
      for _, line in ipairs(data or {}) do
        if line ~= "" then
          table.insert(stderr_lines, line)
        end
      end
    end,
    on_exit = function(_, code)
      vim.schedule(function()
        if code == 0 and vim.loop.fs_stat(tmp) then
          cache_downloaded_sidecar(tmp, dest, marker, asset.sha256)
        else
          local detail = table.concat(stderr_lines, " ")
          notify("Sidecar binary download failed (exit=" .. tostring(code) .. ")" .. (detail ~= "" and " — " .. detail or "") .. " — will keep using Node.js fallback", vim.log.levels.WARN)
        end
      end)
    end,
  })
  if job_id <= 0 then
    notify("Sidecar binary download failed to start — will keep using Node.js fallback", vim.log.levels.WARN)
  end
end

local function prefetch_binary()
  local name = sidecar_binary_name()
  if not name then
    return
  end

  -- Already available (bundled or checksum-verified cached binary)
  if resolve_sidecar_binary() then
    return
  end

  local cache_dir, dest, marker = cache_paths(name)
  vim.fn.mkdir(cache_dir, "p")

  local started = fetch_release_asset(name, function(asset, err)
    if not asset then
      notify("Sidecar binary release metadata could not be verified" .. (err and (" — " .. err) or "") .. " — will keep using Node.js fallback", vim.log.levels.WARN)
      return
    end
    download_sidecar_asset(asset, dest, marker)
  end)

  if started == false then
    notify("Sidecar binary release metadata fetch failed to start — will keep using Node.js fallback", vim.log.levels.WARN)
  end
end

local function encode(value)
  return vim.json and vim.json.encode(value) or vim.fn.json_encode(value)
end

local function send(value)
  if not state.job_id then
    return false
  end
  local ok = vim.fn.chansend(state.job_id, encode(value) .. "\n")
  return ok == 1
end

local function normalize_config(opts)
  local config = vim.tbl_deep_extend("force", defaults, opts or {})
  if config.range_format ~= "dash" then
    config.range_format = "comma"
  end
  return config
end

local function workspace_folders()
  local configured = state.config and state.config.workspace_folders
  if type(configured) == "table" and #configured > 0 then
    return configured
  end

  local folders = { vim.fn.getcwd() }
  for _, client in pairs(vim.lsp.get_clients and vim.lsp.get_clients() or {}) do
    for _, folder in ipairs(client.workspace_folders or {}) do
      if folder.name and folder.name ~= "" then
        table.insert(folders, folder.name)
      elseif folder.uri then
        local path = vim.uri_to_fname(folder.uri)
        if path and path ~= "" then
          table.insert(folders, path)
        end
      end
    end
  end

  local seen = {}
  local result = {}
  for _, folder in ipairs(folders) do
    local normalized = vim.fn.fnamemodify(folder, ":p"):gsub("/$", "")
    if normalized ~= "" and not seen[normalized] then
      seen[normalized] = true
      table.insert(result, normalized)
    end
  end
  return result
end

local function is_path_inside(parent, child)
  parent = vim.fn.fnamemodify(parent, ":p"):gsub("/$", "")
  child = vim.fn.fnamemodify(child, ":p")
  if child:gsub("/$", "") == parent then
    return true
  end
  return child:sub(1, #parent + 1) == parent .. "/"
end

local function best_workspace(file_path)
  local best = nil
  for _, folder in ipairs(workspace_folders()) do
    if is_path_inside(folder, file_path) and (not best or #folder > #best) then
      best = folder
    end
  end
  return best or workspace_folders()[1]
end

local function byte_to_utf16(line, byte_col)
  return vim.str_utfindex(line or "", "utf-16", math.max(0, byte_col), false)
end

local function byte_after_char(line, byte_col)
  line = line or ""
  if byte_col >= #line then
    return #line
  end
  local utf16 = byte_to_utf16(line, byte_col)
  return math.min(#line, vim.str_byteindex(line, "utf-16", utf16 + 1, false))
end

local function compare_positions(a, b)
  if a.line ~= b.line then
    return a.line < b.line
  end
  return a.col <= b.col
end

local function sorted_positions(a, b)
  if compare_positions(a, b) then
    return a, b
  end
  return b, a
end

local function get_lines(buf, start_row, end_row)
  return vim.api.nvim_buf_get_lines(buf, start_row, end_row + 1, false)
end

local function text_from_range(buf, start_row, start_col, end_row, end_col)
  return table.concat(vim.api.nvim_buf_get_text(buf, start_row, start_col, end_row, end_col, {}), "\n")
end

local function range_from_bytes(buf, start_row, start_col, end_row, end_col)
  local lines = get_lines(buf, start_row, end_row)
  local start_line = lines[1] or ""
  local end_line = lines[#lines] or ""
  return {
    text = text_from_range(buf, start_row, start_col, end_row, end_col),
    selection = {
      start = { line = start_row, character = byte_to_utf16(start_line, start_col) },
      ["end"] = { line = end_row, character = byte_to_utf16(end_line, end_col) },
    },
  }
end

local function pos_from_getpos(pos)
  return { line = math.max(0, pos[2] - 1), col = math.max(0, pos[3] - 1), bufnr = pos[1] }
end

local function active_visual_range(buf, mode)
  local start_pos = pos_from_getpos(vim.fn.getpos("v"))
  local end_pos = pos_from_getpos(vim.fn.getpos("."))
  if start_pos.bufnr ~= 0 and start_pos.bufnr ~= buf then
    return {}
  end
  if end_pos.bufnr ~= 0 and end_pos.bufnr ~= buf then
    return {}
  end

  start_pos, end_pos = sorted_positions(start_pos, end_pos)

  if mode == "V" then
    local lines = get_lines(buf, start_pos.line, end_pos.line)
    return { range_from_bytes(buf, start_pos.line, 0, end_pos.line, #(lines[#lines] or "")) }
  end

  if mode == "\022" then
    local start_col = math.min(start_pos.col, end_pos.col)
    local end_col = math.max(start_pos.col, end_pos.col)
    local ranges = {}
    local lines = get_lines(buf, start_pos.line, end_pos.line)
    for offset, line in ipairs(lines) do
      local row = start_pos.line + offset - 1
      local col_start = math.min(start_col, #line)
      local col_end = byte_after_char(line, math.min(end_col, #line))
      if col_start < col_end then
        table.insert(ranges, range_from_bytes(buf, row, col_start, row, col_end))
      end
    end
    return ranges
  end

  local end_line = get_lines(buf, end_pos.line, end_pos.line)[1] or ""
  return { range_from_bytes(buf, start_pos.line, start_pos.col, end_pos.line, byte_after_char(end_line, end_pos.col)) }
end

local function marked_visual_range(buf)
  if not state.visual_mark_valid then
    return {}
  end
  local start_mark = vim.api.nvim_buf_get_mark(buf, "<")
  local end_mark = vim.api.nvim_buf_get_mark(buf, ">")
  if start_mark[1] == 0 or end_mark[1] == 0 then
    return {}
  end
  local start_pos = { line = start_mark[1] - 1, col = start_mark[2], bufnr = buf }
  local end_pos = { line = end_mark[1] - 1, col = end_mark[2], bufnr = buf }
  start_pos, end_pos = sorted_positions(start_pos, end_pos)
  local end_line = get_lines(buf, end_pos.line, end_pos.line)[1] or ""
  return { range_from_bytes(buf, start_pos.line, start_pos.col, end_pos.line, byte_after_char(end_line, end_pos.col)) }
end

function M.snapshot(opts)
  opts = opts or {}
  local buf = vim.api.nvim_get_current_buf()
  if vim.bo[buf].buftype ~= "" then
    return state.latest_snapshot
  end

  local file_path = vim.api.nvim_buf_get_name(buf)
  if file_path == "" then
    return nil
  end
  file_path = vim.fn.fnamemodify(file_path, ":p")

  local mode = vim.fn.mode()
  local ranges = {}
  if mode == "v" or mode == "V" or mode == "\022" then
    ranges = active_visual_range(buf, mode)
  elseif opts.prefer_marks then
    ranges = marked_visual_range(buf)
  end

  local snapshot = {
    source = "nvim",
    filePath = file_path,
    workspaceFolder = best_workspace(file_path),
    ranges = ranges,
  }
  state.latest_snapshot = snapshot
  return snapshot
end

local function relative_path(snapshot)
  local base = snapshot.workspaceFolder or vim.fn.getcwd()
  local rel = vim.fn.fnamemodify(snapshot.filePath, ":p")
  if vim.fs and vim.fs.relpath then
    local ok, value = pcall(vim.fs.relpath, base, snapshot.filePath)
    if ok and value and value ~= "" then
      return value
    end
  end
  local prefix = vim.fn.fnamemodify(base, ":p"):gsub("/$", "") .. "/"
  if rel:sub(1, #prefix) == prefix then
    return rel:sub(#prefix + 1)
  end
  return snapshot.filePath
end

local function line_span(range)
  local start_line = range.selection.start.line + 1
  local end_line = range.selection["end"].line + 1
  if start_line == end_line then
    return "#L" .. start_line
  end
  if state.config and state.config.range_format == "dash" then
    return "#L" .. start_line .. "-L" .. end_line
  end
  return "#L" .. start_line .. "," .. end_line
end

function M.format_range_mention(snapshot)
  local rel = relative_path(snapshot)
  if not snapshot.ranges or #snapshot.ranges == 0 then
    return "@" .. rel
  end
  return "@" .. rel .. line_span(snapshot.ranges[1])
end

local function publish_snapshot()
  if not state.job_id then
    return
  end
  local snapshot = M.snapshot()
  if not snapshot then
    send({ type = "selection_cleared", reason = "no-active-editor" })
    return
  end
  send({ type = "selection_changed", snapshot = snapshot })
end

local function schedule_publish(delay)
  delay = delay or (state.config and state.config.debounce_ms or defaults.debounce_ms)
  if state.timer then
    pcall(state.timer.stop, state.timer)
    pcall(state.timer.close, state.timer)
  end
  state.timer = vim.defer_fn(publish_snapshot, delay)
end

function M.start()
  if state.job_id then
    return true
  end
  state.config = state.config or normalize_config()
  local cmd = state.config.sidecar_cmd or default_sidecar_cmd()
  state.job_id = vim.fn.jobstart(cmd, {
    stdin = "pipe",
    detach = false,
    on_exit = function(_, code)
      state.job_id = nil
      if code ~= 0 then
        notify("sidecar exited with code " .. tostring(code), vim.log.levels.WARN)
      end
    end,
    on_stderr = function(_, data)
      for _, line in ipairs(data or {}) do
        if line ~= "" then
          vim.schedule(function()
            notify(line, vim.log.levels.WARN)
          end)
        end
      end
    end,
  })

  if state.job_id <= 0 then
    state.job_id = nil
    notify("failed to start sidecar", vim.log.levels.ERROR)
    return false
  end

  send({ workspaceFolders = workspace_folders(), name = "Neovim" })
  schedule_publish(0)
  prefetch_binary()
  return true
end

function M.stop()
  if state.timer then
    pcall(state.timer.stop, state.timer)
    pcall(state.timer.close, state.timer)
    state.timer = nil
  end
  if state.job_id then
    send({ type = "shutdown" })
    vim.fn.chanclose(state.job_id, "stdin")
    state.job_id = nil
  end
end

function M.attach()
  if not state.job_id and not M.start() then
    return
  end
  local snapshot = M.snapshot({ prefer_marks = true })
  if not snapshot then
    notify("no active file to attach", vim.log.levels.WARN)
    return
  end
  local range_text = M.format_range_mention(snapshot)
  send({ type = "at_mentioned", snapshot = vim.tbl_extend("force", snapshot, { rangeText = range_text }), rangeText = range_text })
  notify("attached " .. range_text)
end

function M.status()
  notify(state.job_id and "sidecar running" or "sidecar stopped")
end

local function setup_autocmds()
  if state.augroup then
    pcall(vim.api.nvim_del_augroup_by_id, state.augroup)
  end
  state.augroup = vim.api.nvim_create_augroup("PiXIde", { clear = true })
  vim.api.nvim_create_autocmd({ "BufEnter", "WinEnter", "CursorMoved", "CursorMovedI", "TextChanged", "TextChangedI", "DirChanged" }, {
    group = state.augroup,
    callback = function(event)
      if event.event == "DirChanged" then
        send({ type = "workspace_changed", workspaceFolders = workspace_folders() })
      end
      schedule_publish()
    end,
  })
  vim.api.nvim_create_autocmd("ModeChanged", {
    group = state.augroup,
    callback = function(event)
      if event.match and event.match:match("^[vV\022].*:n$") then
        state.visual_mark_valid = true
      end
      schedule_publish(0)
    end,
  })
  vim.api.nvim_create_autocmd("VimLeavePre", {
    group = state.augroup,
    callback = function()
      M.stop()
    end,
  })
end

local function setup_commands()
  local commands = {
    PiXIdeStart = M.start,
    PiXIdeStop = M.stop,
    PiXIdeStatus = M.status,
    PiXIdeAttach = M.attach,
  }
  for name, fn in pairs(commands) do
    pcall(vim.api.nvim_create_user_command, name, fn, {})
  end
end

local function setup_keymap()
  if not state.config.keymap then
    return
  end
  vim.keymap.set({ "n", "v" }, state.config.keymap, M.attach, { desc = "Pi x IDE: attach selection" })
end

function M.setup(opts)
  state.config = normalize_config(opts)
  setup_commands()
  setup_autocmds()
  setup_keymap()
  if state.config.enabled then
    M.start()
  end
end

function M._test_set_visual_mark_valid(value)
  state.visual_mark_valid = value
end

function M._test_reset()
  M.stop()
  state.config = normalize_config({ enabled = false })
  state.latest_snapshot = nil
  state.visual_mark_valid = false
end

setup_commands()

return M
