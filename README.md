# Pi × IDE

> Pi extension package for IDE selection context integration.

Automatically attaches the currently opened or selected file and text range from VS Code, Zed, and Neovim to the Pi TUI, submitting them as conversation context to the LLM.

---

## Installation & Usage

### 1. Install Pi CLI

[Pi Quickstart](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/quickstart.md)

### 2. Install the Pi Extension Package

```bash
pi install npm:pi-x-ide
```

This installs `pi-x-ide` as a global Pi extension. Pi loads it automatically on startup — no flags needed.

### 3. Install the IDE Extension

#### VS Code / Cursor / Windsurf

**Option A: Install from Marketplace (Recommended)**

Install `balaenis.pi-x-ide` from your IDE's Extensions marketplace.

**Option B: Install via Pi CLI**

In Pi's TUI, run `/ide install` — it auto-detects `code`, `cursor`, or `windsurf` and installs the extension.

**Option C: Auto-install on Pi startup**

When Pi starts from a supported VS Code integrated terminal, it attempts to auto-install or update the extension asynchronously. To disable:

```bash
PI_X_IDE_AUTO_INSTALL=0
```

See [Configuration Reference](#pi-side-environment-variables) for all available options.

#### Zed

No extension installation is needed. Pi automatically detects Zed when running inside a Zed terminal (`ZED_TERM=true` or `TERM_PROGRAM=zed`). Pi reads Zed's local state database to discover the active editor file and selection.

#### Neovim

Neovim support uses a Lua plugin plus a sidecar process. On first start the
plugin downloads a standalone binary for your platform (Linux / macOS / Windows,
x64 or arm64) from GitHub Releases. If the download fails, or no binary matches
your platform, the plugin falls back to the bundled Node.js sidecar — Node.js is
then required on PATH.

The binary is cached under `stdpath("cache")/pi-x-ide/` and reused on subsequent
starts. Plugin updates trigger a one-time re-download.

**lazy.nvim:**

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

> **Note:** The `init` block manually adds the `nvim/` subdirectory to the runtime path to avoid a Lua module resolution issue with some lazy.nvim versions.

**Native package:**

```vim
set runtimepath+=/path/to/pi-x-ide/nvim
lua require("pi_x_ide").setup({ keymap = "<leader>pa" })
```

See [Configuration Reference](#neovim-2) for full setup options, commands, and troubleshooting.

### 4. Connect Pi & Verify

Start Pi in the **same project directory** as your IDE workspace:

```bash
pi
```

Pi auto-loads `pi-x-ide` and connects to your IDE. The TUI should display `IDE: vscode ✓` in the footer and a widget showing the IDE name, workspace, current file, and selection range.

**Verify it works:**

Open a file in your IDE and select some text. The widget should update in real time:

```
IDE: vscode ✓ src/foo.ts#L10,20 pending
```

Press `Ctrl+Alt+K` (Linux/Windows) or `Cmd+Alt+K` (macOS) — the Pi input box should insert `@src/foo.ts#L10,20`.

Type a chat prompt in Pi and submit it. The selected text is injected as LLM context (does not persist in session history). After submission, the widget shows `sent`.

**If the connection doesn't appear:**

- Run `/ide auto` in Pi to re-attempt matching.
- If the IDE was started after Pi, reload the IDE window and run `/ide auto` again.
- Run `/ide` to manually select a connection from the list.

### `/ide` Command Reference

| Command        | Behavior                                                          |
| -------------- | ----------------------------------------------------------------- |
| `/ide`         | Open the TUI selector to list available IDE connections           |
| `/ide status`  | Show current connection, workspace, and most recent selection     |
| `/ide list`    | List candidate connections from the lock directory                |
| `/ide auto`    | Re-attempt automatic matching by `cwd` and connect when matched   |
| `/ide off`     | Disconnect and disable automatic context attachment               |
| `/ide attach`  | Manually insert the latest selection range into the input box     |
| `/ide install` | Install or update `balaenis.pi-x-ide` through a supported IDE CLI |

### Configuration Reference

#### VS Code

| Key                  | Type                  | Default   | Description                                   |
| -------------------- | --------------------- | --------- | --------------------------------------------- |
| `piXIde.rangeFormat` | `"comma"` \| `"dash"` | `"comma"` | File reference format for the manual shortcut |

#### Zed

| Environment Variable | Default       | Description                          |
| -------------------- | ------------- | ------------------------------------ |
| `PI_X_IDE_ZED_DB`    | (auto-detect) | Override path to Zed SQLite database |

Default database paths:

- **Linux:** `~/.local/share/zed/db/0-stable/db.sqlite`
- **macOS:** `~/Library/Application Support/Zed/db/0-stable/db.sqlite`
- **Windows:** `%LOCALAPPDATA%\Zed\db\0-stable\db.sqlite`
- **WSL with Windows Zed:** `/mnt/c/Users/<user>/AppData/Local/Zed/db/0-stable/db.sqlite`

When Pi runs in WSL and Zed runs as a Windows app, pi-x-ide normalizes Windows paths (`C:\Users\<user>\project`) to `/mnt/c/Users/<user>/project`, and matching WSL UNC paths to `/home/<user>/project`.

#### Neovim

```lua
require("pi_x_ide").setup({
  enabled = true,
  keymap = "<C-A-k>",
  range_format = "comma", -- or "dash"
  debounce_ms = 150,
  -- sidecar_cmd = { "node", "/absolute/path/to/pi-x-ide-nvim-sidecar.cjs" },
  -- (defaults to the platform binary; falls back to node + cjs if no binary found)
  -- workspace_folders = { "/path/to/project" },
})
```

If the sidecar does not start, run `:PiXIdeStatus`, or set `sidecar_cmd` to a
custom command. The plugin prefers the platform binary but falls back to Node.js
when no binary matches.

**Commands:**

| Command         | Behavior                                                            |
| --------------- | ------------------------------------------------------------------- |
| `:PiXIdeStart`  | Start the Neovim sidecar and write the lock file                    |
| `:PiXIdeStop`   | Stop the sidecar and remove the lock file                           |
| `:PiXIdeStatus` | Show whether the sidecar is running                                 |
| `:PiXIdeAttach` | Attach the current file or selection to Pi as `@relative/path#Lx,y` |

#### Pi-side Environment Variables

Pi-side variables can be set as real environment variables or in `~/.pi/config.json` under `env`. Real environment variables take precedence.

| Variable                | Default       | Description                                  |
| ----------------------- | ------------- | -------------------------------------------- |
| `PI_X_IDE_AUTO_INSTALL` | `1`           | Auto-install VS Code extension on Pi startup |
| `PI_X_IDE_ZED_DB`       | (auto-detect) | Override path to Zed SQLite database         |

See [schemas/config.json](schemas/config.json) for editor schema guidance.

### Feature Parity

| Feature                             | VS Code           | Zed                             | Neovim                        |
| ----------------------------------- | ----------------- | ------------------------------- | ----------------------------- |
| Live file tracking                  | ✅ Real-time push | ✅ 1s polling                   | ✅ Real-time push via sidecar |
| Live selection tracking             | ✅ Real-time push | ✅ 1s polling                   | ✅ Real-time push via sidecar |
| `Ctrl+Alt+K` / `Cmd+Alt+K` shortcut | ✅                | Use `@<relative-path>` manually | User-configured keymap        |
| LLM context injection               | ✅                | ✅                              | ✅                            |
| `/ide auto`                         | ✅                | ✅                              | ✅                            |

### Lock File Protocol

After the IDE WebSocket server starts, connection information is written to `~/.pi/pi-x-ide/lock/`.

Pi uses `ctx.cwd` to find the longest path match against `workspaceFolders` in the lock files, selecting the best-matching and most recent IDE connection. Pi auto-connects only when the current `cwd` is inside or equal to one of the IDE `workspaceFolders`; if `cwd` is only a parent directory such as `~/`, run `/ide` to choose a connection manually.

See [docs/specs/ide-protocol.md](docs/specs/ide-protocol.md) for protocol details.

---

## Development

### Prerequisites

- Node.js ≥ 26
- bun ≥ 1.3 (`packageManager` declared as `bun@1.3.14`)
- VS Code ≥ 1.90 (VS Code extension only)
- Neovim ≥ 0.9 (Neovim plugin only)

### Install & Build

Clone the repository, then build:

```bash
git clone https://github.com/balaenis/pi-x-ide.git
cd pi-x-ide
bun install
bun run build
```

To load the local build without installing globally:

```bash
pi -e ./src/pi/index.ts
```

Common commands:

| Command                  | Description                                                                                        |
| ------------------------ | -------------------------------------------------------------------------------------------------- |
| `bun run build`          | Build Pi-side TypeScript → `dist/` + Neovim sidecar → `nvim/bin/` + VS Code bundle → `vscode/out/` |
| `bun run typecheck`      | Type-check only (no output files)                                                                  |
| `bun run test`           | Build + run unit tests                                                                             |
| `bun run package:vscode` | Package VS Code extension as VSIX                                                                  |
| `bun run vsix`           | Alias for `bun run package:vscode`                                                                 |

### Testing the VS Code Extension Locally

#### Option 1: F5 Extension Development Host (Recommended)

1. Open the **project root** in VS Code.
2. Go to the **Run and Debug** panel (`Ctrl+Shift+D`).
3. Select **Run Pi x IDE VS Code Extension**.
4. Press **F5**:
   - The `preLaunchTask` automatically runs `bun run build`.
   - A new VS Code window titled `[Extension Development Host]` opens.

#### Option 2: Package VSIX and Install

```bash
bun run package:vscode
code --install-extension './vscode'-0.1.0.vsix
```

The extension installed this way runs in all VS Code windows, independent of the F5 Extension Host.

#### Verify the Extension is Running

```bash
ls -l ~/.pi/pi-x-ide/lock
```

You should see a file like `vscode-12345-48123.lock`. If not, run **Developer: Reload Window** in VS Code.

### Release

This project uses [Release Please](https://github.com/googleapis/release-please) with [Conventional Commits](https://www.conventionalcommits.org/) to automate versioning and publishing.

See [RELEASE.md](RELEASE.md) for the full release guide.
