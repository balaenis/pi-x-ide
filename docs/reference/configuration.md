# Configuration reference

Pi × IDE is configured through three layers: per-IDE settings, Pi-side
environment variables, and top-level options in config JSON files.

Config files:

- **Global:** `~/.pi/pi-x-ide/config.json`
- **Project:** `<cwd>/.pi/pi-x-ide/config.json` (overrides global for supported keys)

Pi-side variables can be set as real environment variables **or** in config
`env`. Real environment variables take precedence. Interactive settings
(`Display`, `AutoInstall`, …) are available via [`/ide settings`](commands.md).

```json
{
  "$schema": "https://raw.githubusercontent.com/balaenis/pi-x-ide/refs/heads/main/schemas/config.json",
  "fixPrompt": "Analyze the errors and warnings at the following location, and try to fix them:\n{DIAGNOSTIC}",
  "status_display": "widget",
  "env": {
    "PI_X_IDE_AUTO_INSTALL": "1",
    "PI_X_IDE_ATTACH_SHORTCUT": "ctrl+alt+k"
  }
}
```

See [`config.example.json`](../../config.example.json) for a starting template and
[`schemas/config.json`](../../schemas/config.json) for the editor schema.

## VS Code settings

| Key              | Type      | Default | Description                                                                                                                   |
| ---------------- | --------- | ------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `piXIde.useTmux` | `boolean` | `false` | Open Pi through `tmux` from the terminal icon. Each click creates a new session that is destroyed when the terminal detaches. |

## Zed

| Environment variable            | Default       | Description                                                       |
| ------------------------------- | ------------- | ----------------------------------------------------------------- |
| `PI_X_IDE_ZED_DB`               | (auto-detect) | Override the path to Zed's SQLite database.                       |
| `PI_X_IDE_ZED_POLL_INTERVAL_MS` | `1000`        | Zed SQLite polling interval in milliseconds, clamped to 100–2000. |

Default database paths:

- **Linux:** `~/.local/share/zed/db/0-stable/db.sqlite`
- **macOS:** `~/Library/Application Support/Zed/db/0-stable/db.sqlite`
- **Windows:** `%LOCALAPPDATA%\Zed\db\0-stable\db.sqlite`
- **WSL with Windows Zed:** `/mnt/c/Users/<user>/AppData/Local/Zed/db/0-stable/db.sqlite`

## Neovim

```lua
require("pi_x_ide").setup({
  enabled = true,
  keymap = "<C-A-k>",
  debounce_ms = 150,
  -- sidecar_cmd = { "node", "/absolute/path/to/pi-x-ide-nvim-sidecar.cjs" },
  -- workspace_folders = { "/path/to/project" },
})
```

| Option              | Default   | Description                                      |
| ------------------- | --------- | ------------------------------------------------ |
| `enabled`           | `true`    | Enable or disable the plugin.                    |
| `keymap`            | `<C-A-k>` | Keymap to attach the current selection to Pi.    |
| `debounce_ms`       | `150`     | Debounce interval for selection notifications.   |
| `sidecar_cmd`       | (auto)    | Override the sidecar command.                    |
| `workspace_folders` | (auto)    | Override the workspace folders advertised to Pi. |

If the sidecar does not start, run `:PiXIdeStatus`, or set `sidecar_cmd` to a
custom command. See
[Install the Neovim plugin](../how-to/install-neovim.md#troubleshoot-the-sidecar).

| Command         | Behavior                                                              |
| --------------- | --------------------------------------------------------------------- |
| `:PiXIdeStart`  | Start the Neovim sidecar and write the lock file.                     |
| `:PiXIdeStop`   | Stop the sidecar and remove the lock file.                            |
| `:PiXIdeStatus` | Show whether the sidecar is running.                                  |
| `:PiXIdeAttach` | Attach the current file or selection to Pi as `@relative/path#Lx-Ly`. |

## Pi-side environment variables

| Variable                        | Default       | Description                                                                                                                                   |
| ------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `PI_X_IDE_AUTO_INSTALL`         | `1`           | Auto-install the VS Code extension on Pi startup. Set to `0`/`false`/`off` to disable. Also configurable as `AutoInstall` in `/ide settings`. |
| `PI_X_IDE_ATTACH_SHORTCUT`      | `ctrl+alt+k`  | Pi TUI shortcut for `/ide attach`. Set to `off`, `none`, `false`, or `0` to disable.                                                          |
| `PI_X_IDE_HOST_OVERRIDE`        | (unset)       | Override the host Pi uses for IDE WebSocket connections. Useful for WSL2 networking.                                                          |
| `PI_X_IDE_ZED_DB`               | (auto-detect) | Override the path to Zed's SQLite database.                                                                                                   |
| `PI_X_IDE_ZED_POLL_INTERVAL_MS` | `1000`        | Zed SQLite polling interval in milliseconds, clamped to 100–2000.                                                                             |

## Top-level options

<a id="top-level-options"></a>

| Option           | Default                                                                                         | Description                                                                                                                                                                                                                                  |
| ---------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fixPrompt`      | `Analyze the errors and warnings at the following location, and try to fix them:\n{DIAGNOSTIC}` | Custom prompt prefix when requesting a fix for IDE diagnostics. Use `{DIAGNOSTIC}` as a placeholder for the diagnostic context. If the placeholder is omitted, the diagnostic context is appended after your prompt.                         |
| `status_display` | `widget`                                                                                        | Where to show IDE connection status in the Pi TUI. Default `widget` (above-editor); `statusline` uses the footer status line. Only one placement is active at a time. Project config overrides global. Set as `Display` via `/ide settings`. |

The `fixPrompt` controls the prompt used by the VS Code **Pi: Fix it** Quick Fix
action. See [Install the VS Code extension](../how-to/install-vscode.md#diagnostic-quick-fix).
