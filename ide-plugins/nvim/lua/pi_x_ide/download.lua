-- ABOUTME: Resolves and downloads the Pi x IDE Neovim sidecar binary from GitHub Releases.
-- ABOUTME: Shared by the runtime fallback (init.lua) and the lazy.nvim build step (run).
---@diagnostic disable: undefined-global
local D = {}

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

local function marker_digest(marker)
  local ok, lines = pcall(vim.fn.readfile, marker)
  if not ok or type(lines) ~= "table" then
    return nil
  end
  return normalize_sha256_digest(lines[2])
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

local function cache_matches_release(path, marker, expected_sha256)
  return marker_matches(path, marker) and marker_digest(marker) == normalize_sha256_digest(expected_sha256)
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

local function bundled_sidecar_binary(name)
  local bundled = plugin_root() .. "/bin/" .. name
  if vim.loop.fs_stat(bundled) then
    ensure_executable(bundled)
    return bundled
  end
  return nil
end

local function resolve_sidecar_binary()
  local name = sidecar_binary_name()
  if not name then
    return nil
  end

  -- 1. Bundled with the plugin (npm / manual install)
  local bundled = bundled_sidecar_binary(name)
  if bundled then
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

local function cache_downloaded_sidecar(tmp, dest, marker, expected_sha256, on_finished)
  local verified, verify_err = verify_downloaded_sidecar(tmp, expected_sha256)
  if not verified then
    os.remove(tmp)
    os.remove(marker)
    notify("Sidecar binary download failed SHA256 verification" .. (verify_err and (" — " .. verify_err) or "") .. " — deleted; will retry next restart", vim.log.levels.WARN)
    return on_finished and on_finished(false)
  end

  os.remove(dest)
  os.remove(marker)
  local ok, rename_err = vim.loop.fs_rename(tmp, dest)
  if ok and write_marker(dest, marker, expected_sha256) then
    notify("Sidecar binary ready (restart Neovim to use it)", vim.log.levels.INFO)
    return on_finished and on_finished(true)
  end

  os.remove(tmp)
  os.remove(dest)
  os.remove(marker)
  notify("Sidecar binary download could not be cached" .. (rename_err and (" — " .. rename_err) or "") .. " — will retry next restart", vim.log.levels.WARN)
  return on_finished and on_finished(false)
end

local function download_sidecar_asset(asset, dest, marker, on_finished)
  local tmp = download_path(dest)
  if not sha256_command(tmp) then
    notify("Sidecar binary download requires sha256sum, shasum, or certutil for verification — will keep using Node.js fallback", vim.log.levels.WARN)
    return on_finished and on_finished(false)
  end

  local tool = download_command(asset.url, tmp)
  if not tool then
    return on_finished and on_finished(false)
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
          cache_downloaded_sidecar(tmp, dest, marker, asset.sha256, on_finished)
        else
          local detail = table.concat(stderr_lines, " ")
          notify("Sidecar binary download failed (exit=" .. tostring(code) .. ")" .. (detail ~= "" and " — " .. detail or "") .. " — will keep using Node.js fallback", vim.log.levels.WARN)
          if on_finished then
            on_finished(false)
          end
        end
      end)
    end,
  })
  if job_id <= 0 then
    notify("Sidecar binary download failed to start — will keep using Node.js fallback", vim.log.levels.WARN)
    return on_finished and on_finished(false)
  end
end

-- Ensures the sidecar binary is present, downloading it from the latest
-- GitHub Release when necessary. The whole pipeline is asynchronous; the
-- optional on_finished(success) callback fires once the work settles.
local function ensure_binary(opts, on_finished)
  if type(opts) == "function" then
    on_finished = opts
    opts = {}
  end
  opts = opts or {}

  local name = sidecar_binary_name()
  if not name then
    return on_finished and on_finished(false)
  end

  -- Bundled binaries are part of the plugin checkout/package, so they already
  -- follow the installed plugin version and do not need a release metadata hit.
  if bundled_sidecar_binary(name) then
    return on_finished and on_finished(true)
  end

  local cache_dir, dest, marker = cache_paths(name)

  -- Runtime fallback stays fast and offline when a verified cache exists.
  -- Build refresh checks release metadata so cache follows plugin updates.
  if not opts.refresh and marker_matches(dest, marker) then
    ensure_executable(dest)
    return on_finished and on_finished(true)
  end
  if not opts.refresh and vim.loop.fs_stat(dest) then
    os.remove(dest)
    os.remove(marker)
  end

  vim.fn.mkdir(cache_dir, "p")

  local started = fetch_release_asset(name, function(asset, err)
    if not asset then
      notify("Sidecar binary release metadata could not be verified" .. (err and (" — " .. err) or "") .. " — will keep using Node.js fallback", vim.log.levels.WARN)
      return on_finished and on_finished(false)
    end
    if cache_matches_release(dest, marker, asset.sha256) then
      ensure_executable(dest)
      return on_finished and on_finished(true)
    end
    download_sidecar_asset(asset, dest, marker, on_finished)
  end)

  if not started then
    notify("Sidecar binary release metadata fetch failed to start — will keep using Node.js fallback", vim.log.levels.WARN)
    return on_finished and on_finished(false)
  end
end

-- Public API ---------------------------------------------------------------

D.platform_target = platform_target
D.sidecar_binary_name = sidecar_binary_name
D.cache_paths = cache_paths
D.ensure_executable = ensure_executable
D.verify_sidecar_binary = verify_sidecar_binary
D.resolve_sidecar_binary = resolve_sidecar_binary
D.plugin_root = plugin_root

-- Runtime fallback: fire-and-forget prefetch used by init.lua during start().
function D.prefetch()
  ensure_binary({ refresh = false })
end

-- Build step entry point for lazy.nvim (`build = "..."`).
-- Runs the download synchronously so the build task reflects the real result,
-- because lazy.nvim does not await the asynchronous jobs spawned above. Build
-- refreshes release metadata by default, but only downloads when the cached
-- SHA256 differs from the release asset digest.
function D.run(opts)
  opts = opts or {}
  local timeout = opts.timeout or (5 * 60 * 1000)
  local done = false
  local succeeded = false
  local refresh = opts.refresh ~= false

  ensure_binary({ refresh = refresh }, function(success)
    succeeded = success
    done = true
  end)

  vim.wait(timeout, function()
    return done
  end, 100)

  if not done then
    notify("Sidecar binary download timed out — will keep using Node.js fallback", vim.log.levels.WARN)
  end
  return succeeded
end

return D
