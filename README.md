# Pi × IDE

Pi extension package for IDE selection context integration.

Automatically attaches the currently opened or selected file and text range from VS Code-family IDEs, Zed, and Neovim to the Pi TUI, submitting them as conversation context to the LLM.

## Prerequisites

- Node.js ≥ 26
- pnpm ≥ 11 (declared as `pnpm@11.5.2` in `packageManager`)
- VS Code ≥ 1.90 (VS Code extension only)
- Neovim ≥ 0.9 (Neovim plugin only)
- Pi CLI (`@earendil-works/pi-coding-agent ≥ 0.79`)

## Install & Build

```bash
pnpm install
pnpm build
```

Common commands:

| Command               | Description                                                                                        |
| --------------------- | -------------------------------------------------------------------------------------------------- |
| `pnpm build`          | Build Pi-side TypeScript → `dist/` + Neovim sidecar → `nvim/bin/` + VS Code bundle → `vscode/out/` |
| `pnpm typecheck`      | Type-check only (no output files)                                                                  |
| `pnpm test`           | Build + run unit tests                                                                             |
| `pnpm package:vscode` | Package VS Code extension as VSIX                                                                  |
| `pnpm vsix`           | Alias for `pnpm package:vscode`                                                                    |

## Testing the VS Code Extension Locally

### Option 1: F5 Extension Development Host (Recommended)

1. Open the **project root** in VS Code.
2. Go to the **Run and Debug** panel (`Ctrl+Shift+D`).
3. Select **Run Pi x IDE VS Code Extension**.
4. Press **F5**:
   - The `preLaunchTask` will automatically run `pnpm build`.
   - A new VS Code window titled `[Extension Development Host]` opens.

### Option 2: Package VSIX and Install

```bash
pnpm package:vscode
code --install-extension './vscode'-0.1.0.vsix
```

The extension installed this way runs in all VS Code windows, independent of the F5 Extension Host.

### Verify the Extension is Running

```bash
ls -l ~/.pi/pi-x-ide/lock
```

You should see a file like `vscode-12345-48123.lock`.

If not, run **Developer: Reload Window** in VS Code.

## Connecting to Pi

Start Pi in the **same project directory**:

```bash
pi -e ./src/pi/index.ts
```

The Pi TUI should display:

- Footer: `IDE: vscode ✓`
- A widget below the input box showing: IDE name, workspace, current file, selection range, and `pending/sent` status

When Pi starts from a supported VS Code-family integrated terminal, it also tries to auto-install or update the Marketplace extension `balaenis.pi-x-ide` asynchronously. This does not block Pi startup. To disable only this install attempt, set:

```bash
PI_X_IDE_AUTO_INSTALL=0
```

Pi-side environment variables can also be configured in `~/.pi/config.json`:

```json
{
  "env": {
    "PI_X_IDE_AUTO_INSTALL": "0"
  }
}
```

Real environment variables take precedence over values from `~/.pi/config.json`. See [schemas/config.json](schemas/config.json) for editor schema guidance.

If VS Code was started after Pi, run the following in Pi:

```
/ide auto
```

If auto-install succeeds but no connection appears, reload the IDE window and run `/ide auto` again. You can also run `/ide install` to choose a supported `code`, `cursor`, or `windsurf` CLI manually.

## Feature Verification

### Live Selection

Open a file in VS Code and select some text. The Pi TUI widget should update in real time:

```
IDE: vscode ✓ src/foo.ts#L10,20 pending
```

### Manual Keyboard Shortcut

Select text in VS Code and press:

- Linux/Windows: `Ctrl+Alt+K`
- macOS: `Cmd+Alt+K`

The Pi input box should insert:

```
@src/foo.ts#L10,20
```

### LLM Context Injection

Type a normal chat prompt in Pi. When you submit it to the LLM, the currently `pending` selected text is temporarily injected as a `context` event — it does not persist in the session history.

After submission, the TUI displays `sent`.

## `/ide` Command Reference

| Command        | Behavior                                                          |
| -------------- | ----------------------------------------------------------------- |
| `/ide`         | Open the TUI selector to list available IDE connections           |
| `/ide status`  | Show current connection, workspace, and most recent selection     |
| `/ide list`    | List candidate connections from the lock directory                |
| `/ide auto`    | Re-attempt automatic matching by `cwd` and connect when matched   |
| `/ide off`     | Disconnect and disable automatic context attachment               |
| `/ide attach`  | Manually insert the latest selection range into the input box     |
| `/ide install` | Install or update `balaenis.pi-x-ide` through a supported IDE CLI |

## Lock File Protocol

After the IDE WebSocket server starts, connection information is written to `~/.pi/pi-x-ide/lock/` by default. Override the directory with `PI_X_IDE_LOCK_DIR` as an environment variable or in `~/.pi/config.json` under `env`.

Pi uses `ctx.cwd` to find the longest path match against `workspaceFolders` in the lock files, selecting the best-matching and most recent IDE connection. Pi auto-connects only when the current `cwd` is inside or equal to one of the IDE `workspaceFolders`; if `cwd` is only a parent directory such as `~/`, run `/ide` to choose a connection manually.

See [docs/specs/ide-protocol.md](docs/specs/ide-protocol.md) for protocol details.

## Release

This project uses [Release Please](https://github.com/googleapis/release-please) with [Conventional Commits](https://www.conventionalcommits.org/) to automate versioning and publishing.

See [RELEASE.md](RELEASE.md) for the full release guide.

## VS Code Configuration

| Key                  | Type                  | Default   | Description                                   |
| -------------------- | --------------------- | --------- | --------------------------------------------- |
| `piXIde.rangeFormat` | `"comma"` \| `"dash"` | `"comma"` | File reference format for the manual shortcut |

## Zed Editor Support

Pi detects Zed automatically when running inside a Zed terminal (`ZED_TERM=true` or `TERM_PROGRAM=zed`). No Zed extension is required.

### How It Works

Pi reads Zed's local SQLite state database to discover the active editor file, selected text ranges, and buffer contents. The database is polled once per second, and changes are reflected in the Pi TUI widget.

### Requirements

- Zed running on the same machine
- Pi launched from Zed's integrated terminal
- Node.js ≥ 26 (required for `node:sqlite`)

### Configuration

| Environment Variable | Default       | Description                          |
| -------------------- | ------------- | ------------------------------------ |
| `PI_X_IDE_ZED_DB`    | (auto-detect) | Override path to Zed SQLite database |

This Pi-side variable can also be set in `~/.pi/config.json` under `env`.

Default database paths:

- **Linux:** `~/.local/share/zed/db/0-stable/db.sqlite`
- **macOS:** `~/Library/Application Support/Zed/db/0-stable/db.sqlite`
- **Windows:** `%LOCALAPPDATA%\\Zed\\db\\0-stable\\db.sqlite`
- **WSL with Windows Zed:** `/mnt/c/Users/<user>/AppData/Local/Zed/db/0-stable/db.sqlite`

When Pi runs in WSL and Zed runs as a Windows app, pi-x-ide normalizes Windows paths such as `C:\\Users\\<user>\\project` to `/mnt/c/Users/<user>/project`, and matching WSL UNC paths such as `\\\\wsl.localhost\\Ubuntu\\home\\<user>\\project` to `/home/<user>/project`.

## Neovim Editor Support

Neovim support is provided by a Lua plugin plus a bundled Node.js sidecar. The plugin starts the sidecar, the sidecar writes an `nvim-<pid>-<port>.lock` file to `~/.pi/pi-x-ide/`, and Pi connects through the same `/ide` flow used by VS Code.

Pi can run in any terminal whose current directory matches the Neovim workspace; it does not have to run inside Neovim.

### lazy.nvim Example

```lua
{
  "balaenis/pi-x-ide",
  init = function()
    vim.opt.rtp:prepend(vim.fn.stdpath("data") .. "/lazy/pi-x-ide/nvim")
  end,
  config = function()
    require("pi_x_ide").setup({
      keymap = "<C-A-k>",
    })
  end,
}
```

> **Note:** The `init` block manually adds the `nvim/` subdirectory to the runtime path.
> This avoids a Lua module resolution issue with lazy.nvim's `rtp` option on some versions.

### Native Package Example

Clone this repository into a Neovim `pack/*/start` directory, then add the `nvim` runtime path and call setup:

```vim
set runtimepath+=/path/to/pi-x-ide/nvim
lua require("pi_x_ide").setup({ keymap = "<leader>pa" })
```

### Neovim Commands

| Command         | Behavior                                                            |
| --------------- | ------------------------------------------------------------------- |
| `:PiXIdeStart`  | Start the Neovim sidecar and write the lock file                    |
| `:PiXIdeStop`   | Stop the sidecar and remove the lock file                           |
| `:PiXIdeStatus` | Show whether the sidecar is running                                 |
| `:PiXIdeAttach` | Attach the current file or selection to Pi as `@relative/path#Lx,y` |

### Neovim Configuration

```lua
require("pi_x_ide").setup({
  enabled = true,
  keymap = "<C-A-k>",
  range_format = "comma", -- or "dash"
  debounce_ms = 150,
  -- sidecar_cmd = { "node", "/absolute/path/to/pi-x-ide-nvim-sidecar.cjs" },
  -- workspace_folders = { "/path/to/project" },
})
```

If the sidecar does not start, run `:PiXIdeStatus`, confirm Node.js is available on Neovim's `PATH`, or set `sidecar_cmd` to an absolute Node command.

### Feature Parity

| Feature                             | VS Code           | Zed                             | Neovim                        |
| ----------------------------------- | ----------------- | ------------------------------- | ----------------------------- |
| Live file tracking                  | ✅ Real-time push | ✅ 1s polling                   | ✅ Real-time push via sidecar |
| Live selection tracking             | ✅ Real-time push | ✅ 1s polling                   | ✅ Real-time push via sidecar |
| `Ctrl+Alt+K` / `Cmd+Alt+K` shortcut | ✅                | Use `@<relative-path>` manually | User-configured keymap        |
| LLM context injection               | ✅                | ✅                              | ✅                            |
| `/ide auto`                         | ✅                | ✅                              | ✅                            |
