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

local function default_sidecar_cmd()
  return { "node", plugin_root() .. "/bin/pi-x-ide-nvim-sidecar.cjs" }
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
