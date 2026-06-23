# Pi × IDE

> Pi extension package for IDE selection context integration.

Automatically attaches the currently opened or selected file and text range from VS Code, Zed, Neovim, and JetBrains IDEs to the Pi TUI, submitting them as conversation context to the LLM.

<img width="3822" height="2010" alt="pi-x-ide-guide" src="https://github.com/user-attachments/assets/70abe40d-e4ac-4c2e-aca7-80d2e7867945" />


## Installation & Usage

### Install the Pi Extension Package

```bash
pi install npm:pi-x-ide
```

### Install the IDE Extension

#### VS Code / Cursor / Windsurf

**Option A: Install from Marketplace (Recommended)**

Install [balaenis.pi-x-ide](https://marketplace.visualstudio.com/items?itemName=balaenis.pi-x-ide) from your IDE's Extensions marketplace.

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

Neovim support uses a Lua plugin plus a sidecar process. The plugin auto-downloads
a platform binary on first start and falls back to Node.js if unavailable.

**lazy.nvim:**

```lua
{
  "balaenis/pi-x-ide",
  build = function(plugin)
    vim.opt.rtp:prepend(plugin.dir .. "/ide-plugins/nvim")
    require("pi_x_ide.download").run({ refresh = true })
  end,
  init = function(plugin)
    vim.opt.rtp:prepend(plugin.dir .. "/ide-plugins/nvim")
  end,
  main = "pi_x_ide",
  opts = {
    keymap = "<leader>aa",
  },
}
```

> **Note:** The `init` block adds the plugin subdirectory to the runtime path to
> work around a Lua module resolution issue with some lazy.nvim versions. The
> optional `build` hook pre-downloads the sidecar binary; it is safe to omit —
> the plugin downloads it lazily on first start.

**Native package:**

```vim
set runtimepath+=/path/to/pi-x-ide/ide-plugins/nvim
lua require("pi_x_ide").setup({ keymap = "<leader>pa" })
```

See [Configuration Reference](#neovim-2) for full setup options, commands, and troubleshooting.

#### JetBrains IDEs

Download the latest JetBrains plugin ZIP(pi-x-ide-jetbrains-*.zip) from the [latest GitHub Release](https://github.com/balaenis/pi-x-ide/releases/latest), then install it in your JetBrains IDE via **Settings | Plugins | ⚙ | Install Plugin from Disk...**.

### Connect Pi & Verify

Start Pi in the **same project directory** as your IDE workspace:

```bash
pi
```

Pi auto-loads `pi-x-ide` and connects to your IDE. The TUI shows a widget above the
editor with the current IDE connection and selection state.

**Verify it works:**

Open a file in your IDE and select some text. The widget should update in real time:

```
⧉ ⇡ foo.ts#L10-L20
```

Attach the selection from either side: press `Ctrl+Alt+K` (Linux/Windows) or `Cmd+Alt+K` (macOS) in a VS Code-family IDE, press `Ctrl+Alt+K` or run **Pi x IDE: Attach Selection** in JetBrains, use `:PiXIdeAttach` in Neovim, or focus the Pi TUI and press `Ctrl+Alt+K` / run `/ide attach`. The Pi input box should insert `@src/foo.ts#L10-L20`.

Type a chat prompt in Pi and submit it. The selected text is injected as LLM context.
After submission, the widget changes to
`⧉ ✓ foo.ts#L10-L20`.

**Diagnostic Quick Fix (VS Code only):** place the cursor on an error or warning,
open Quick Fix, and choose **Pi: Fix it** to send the diagnostic to Pi and start an
analysis turn, or **Pi: Send diagnostic** to paste it into the input box.

**If the connection doesn't appear:**

- Run `/ide auto` in Pi to re-attempt matching.
- If the IDE was started after Pi, reload the IDE window and run `/ide auto` again.
- Run `/ide` to manually select a connection from the list.

### WSL2

When Pi runs inside WSL2 and your IDE runs on native Windows, Pi automatically
discovers the IDE connection across the WSL boundary. No extra configuration is
needed in most cases.

If your WSL networking mode, firewall, or endpoint security blocks the automatic
discovery, set `PI_X_IDE_HOST_OVERRIDE`:

```bash
PI_X_IDE_HOST_OVERRIDE=127.0.0.1 pi
PI_X_IDE_HOST_OVERRIDE=<windows-host-ip> pi
```

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

Pi also registers `Ctrl+Alt+K` in the TUI as a shortcut for `/ide attach` by default. Repeated presses append the latest selected range to the current input, so you can select multiple ranges in the editor and attach them one by one. On macOS, this is a terminal shortcut (`Ctrl+Option+K`); `Cmd` shortcuts are handled by the terminal/OS and are not available to Pi's TUI. Set `PI_X_IDE_ATTACH_SHORTCUT` to another pi key id to customize it, or to `off`/`none`/`false`/`0` to disable it.

### Configuration Reference

#### VS Code

| Key              | Type      | Default | Description                                                                                                                   |
| ---------------- | --------- | ------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `piXIde.useTmux` | `boolean` | `false` | Open Pi through `tmux` from the terminal icon. Each click creates a new session that is destroyed when the terminal detaches. |

#### Zed

| Environment Variable | Default       | Description                          |
| -------------------- | ------------- | ------------------------------------ |
| `PI_X_IDE_ZED_DB`    | (auto-detect) | Override path to Zed SQLite database |

Default database paths:

- **Linux:** `~/.local/share/zed/db/0-stable/db.sqlite`
- **macOS:** `~/Library/Application Support/Zed/db/0-stable/db.sqlite`
- **Windows:** `%LOCALAPPDATA%\Zed\db\0-stable\db.sqlite`
- **WSL with Windows Zed:** `/mnt/c/Users/<user>/AppData/Local/Zed/db/0-stable/db.sqlite`

#### Neovim

```lua
require("pi_x_ide").setup({
  enabled = true,
  keymap = "<C-A-k>",
  debounce_ms = 150,
  -- sidecar_cmd = { "node", "/absolute/path/to/pi-x-ide-nvim-sidecar.cjs" },
  -- workspace_folders = { "/path/to/project" },
})
```

If the sidecar does not start, run `:PiXIdeStatus`, or set `sidecar_cmd` to a
custom command.

**Commands:**

| Command         | Behavior                                                             |
| --------------- | -------------------------------------------------------------------- |
| `:PiXIdeStart`  | Start the Neovim sidecar and write the lock file                     |
| `:PiXIdeStop`   | Stop the sidecar and remove the lock file                            |
| `:PiXIdeStatus` | Show whether the sidecar is running                                  |
| `:PiXIdeAttach` | Attach the current file or selection to Pi as `@relative/path#Lx-Ly` |

#### Pi-side Environment Variables

Pi-side variables can be set as real environment variables or in `~/.pi/pi-x-ide/config.json` under `env`. Real environment variables take precedence.

| Variable                        | Default       | Description                                                                         |
| ------------------------------- | ------------- | ----------------------------------------------------------------------------------- |
| `PI_X_IDE_AUTO_INSTALL`         | `1`           | Auto-install VS Code extension on Pi startup                                        |
| `PI_X_IDE_ATTACH_SHORTCUT`      | `ctrl+alt+k`  | Pi TUI shortcut for `/ide attach`; set to `off`, `none`, `false`, or `0` to disable |
| `PI_X_IDE_HOST_OVERRIDE`        | (unset)       | Override the host Pi uses for IDE WebSocket lock files; useful for WSL2 networking  |
| `PI_X_IDE_ZED_DB`               | (auto-detect) | Override path to Zed SQLite database                                                |
| `PI_X_IDE_ZED_POLL_INTERVAL_MS` | `1000`        | Zed SQLite polling interval, clamped to 100-2000 ms                                 |

#### Top-level Configuration Options

| Option       | Default                                                                                         | Description                                                                                                                                                                                                          |
| ------------ | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fix_prompt` | `Analyze the errors and warnings at the following location, and try to fix them:\n{DIAGNOSTIC}` | Custom prompt prefix when requesting a fix for IDE diagnostics. Use `{DIAGNOSTIC}` as a placeholder for the diagnostic context. If the placeholder is omitted, the diagnostic context is appended after your prompt. |

See [schemas/config.json](schemas/config.json) for editor schema guidance. A [config.example.json](config.example.json) is provided as a starting template.

### Feature Parity

| Feature                                              | VS Code                 | Zed        | Neovim                        | JetBrains               |
| ---------------------------------------------------- | ----------------------- | ---------- | ----------------------------- | ----------------------- |
| Live file tracking                                   | ✅ Real-time push       | ✅ polling | ✅ Real-time push via sidecar | ✅ Real-time push       |
| Live selection tracking                              | ✅ Real-time push       | ✅ polling | ✅ Real-time push via sidecar | ✅ Real-time push       |
| IDE context attach shortcut                          | ✅ Default `Ctrl+Alt+K` | ❌         | ✅ Custom configured keymap   | ✅ Default `Ctrl+Alt+K` |
| Pi TUI context attach shortcut(default `Ctrl+Alt+K`) | ✅                      | ✅         | ✅                            | ✅                      |
| LLM context injection                                | ✅                      | ✅         | ✅                            | ✅                      |
| `/ide auto`                                          | ✅                      | ✅         | ✅                            | ✅                      |
| Diagnostic Quick Fix                                 | ✅                      | ❌         | ❌                            | ❌                      |
| Auto-install                                         | ✅ VS Code-family only  | N/A        | ❌                            | ❌                      |

### How Discovery Works

Pi discovers IDE connections via lock files under `~/.pi/pi-x-ide/lock/`. It
auto-connects when your terminal `cwd` is inside one of the IDE's workspace
folders. If `cwd` is only a parent directory (e.g. `~/`), run `/ide` to choose a
connection manually.

See [docs/specs/ide-protocol.md](docs/specs/ide-protocol.md) for the full protocol.

---

## Development

### Prerequisites

- Node.js ≥ 26
- bun ≥ 1.3 (`packageManager` declared as `bun@1.3.14`)
- VS Code ≥ 1.120.0 (VS Code extension only)
- Neovim ≥ 0.9 (Neovim plugin only)
- JDK 21 (JetBrains plugin only; Gradle can download the toolchain automatically)

### Install & Build

Clone the repository, then build:

```bash
git clone https://github.com/balaenis/pi-x-ide.git
cd pi-x-ide
mise run setup
mise run build
```

To load the local build without installing globally:

```bash
pi -e ./src/pi/index.ts
```

All build and check commands are defined as `mise run` tasks (see `.mise/tasks/`):

| Command                        | Description                                                                                                                |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `mise run build`               | Build Pi-side TypeScript → `dist/` + Neovim sidecar → `ide-plugins/nvim/bin/` + VS Code bundle → `ide-plugins/vscode/out/` |
| `mise run typecheck`           | Type-check only (no output files)                                                                                          |
| `mise run test`                | Build + run unit tests                                                                                                     |
| `mise run package:vsix`        | Package VS Code extension as VSIX                                                                                          |
| `mise run compile:jetbrains`   | Compile and test the JetBrains plugin with Gradle                                                                          |
| `mise run package:jetbrains`   | Package the JetBrains plugin ZIP under `ide-plugins/jetbrains/build/distributions/`                                        |
| `mise run verify:jetbrains`    | Run IntelliJ Plugin Verifier for the configured target IDE                                                                 |
| `mise run check:config-schema` | Verify `schemas/config.json` is in sync with the config registry                                                           |

### Testing the VS Code Extension Locally

#### Option 1: F5 Extension Development Host (Recommended)

1. Open the **project root** in VS Code.
2. Go to the **Run and Debug** panel (`Ctrl+Shift+D`).
3. Select **Run Pi x IDE VS Code Extension**.
4. Press **F5**:
   - The `preLaunchTask` automatically runs `mise run build`.
   - A new VS Code window titled `[Extension Development Host]` opens.

#### Option 2: Package VSIX and Install

```bash
mise run package:vsix
cd ide-plugins/vscode && code --install-extension dist/pi-x-ide-$(node -p "require('./package.json').version").vsix
```

The extension installed this way runs in all VS Code windows, independent of the F5 Extension Host.

#### Verify the Extension is Running

```bash
ls -l ~/.pi/pi-x-ide/lock
```

You should see a file like `vscode-12345-48123.lock`. If not, run **Developer: Reload Window** in VS Code.

### Testing the JetBrains Plugin Locally

Run a sandbox IDE:

```bash
cd ide-plugins/jetbrains
./gradlew runIde
```

Build the installable plugin ZIP:

```bash
mise run package:jetbrains
```

The ZIP is written under `ide-plugins/jetbrains/build/distributions/`. For a smoke test, open this repository in the sandbox IDE, start `pi` from the same directory, open and select text in a local file, then press `Ctrl+Alt+K` or run **Pi x IDE: Attach Selection**. Pi should receive an `@relative/path#Lx-Ly` mention.

### Release

This project uses [Release Please](https://github.com/googleapis/release-please) with [Conventional Commits](https://www.conventionalcommits.org/) to automate versioning and publishing.

See [RELEASE.md](RELEASE.md) for the full release guide.

## Acknowledgments

- [opencode](https://github.com/anomalyco/opencode)
