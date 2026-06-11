# Neovim Support Implementation Plan

**Goal:** Add Neovim editor selection-context support to pi-x-ide with feature parity for file tracking, selection tracking, manual attach, and Pi prompt context injection.

**Inputs:** User request for Neovim support, repository evidence from `src/pi/index.ts`, `src/pi/connection.ts`, `src/pi/context.ts`, `src/shared/protocol.ts`, `vscode/src/extension.ts`, `vscode/src/server.ts`, `vscode/src/selection.ts`, `docs/specs/ide-protocol.md`, `docs/zed-integration-analysis.md`, and current Neovim API documentation for Lua autocommands, user commands, buffer APIs, marks, `nvim_buf_get_text()`, `vim.str_utfindex()`, and job control.

**Assumptions:**

- The target is Neovim 0.9+; the implementation should be tested on the local 0.12.x runtime and avoid APIs newer than 0.9 unless guarded.
- The first supported workflow is a Neovim Lua plugin plus a bundled Node.js sidecar process. This preserves the existing WebSocket lock-file protocol and lets Pi connect whether it was launched inside or outside Neovim.
- Automatic Neovim plugin installation is out of scope for the first release because Neovim has no single standard package manager or marketplace CLI comparable to VS Code's `code --install-extension`.
- Neovim visual-block selections will be represented as multiple per-line ranges in the existing `ranges: SelectionRange[]` protocol.

**Architecture:** Create a Neovim Lua plugin that observes the active file buffer and visual selection, starts a bundled Node sidecar, and streams newline-delimited JSON updates to the sidecar over stdin. The sidecar reuses the existing pi-x-ide WebSocket lock-file protocol: it writes an `nvim-<pid>-<port>.lock` file under `~/.pi/pi-x-ide`, accepts authenticated Pi WebSocket clients, responds to `initialize`, and broadcasts `selection_changed`, `selection_cleared`, and `at_mentioned` notifications. Pi-side code remains mostly unchanged except for adding `nvim` as an `IdeSource` and updating docs/tests.

**Tech Stack:** TypeScript, Node.js 26, `ws`, esbuild bundle for the Neovim sidecar, Neovim Lua API, existing pi extension APIs, `node:test`, headless `nvim` tests.

---

## File Map

- Create: `src/shared/ide-server.ts` — Generic authenticated JSON-RPC WebSocket server shared by VS Code and Neovim sidecar.
- Create: `src/shared/lock-file.ts` — Shared auth-token generation, lock-file path creation, atomic write, refresh, and removal helpers.
- Modify: `src/shared/protocol.ts` — Add `"nvim"` to `IdeSource` and keep protocol version at `1` because payload shape remains compatible.
- Modify: `src/shared/schema.ts` — Accept `"nvim"` in `isIdeSource()`.
- Modify: `vscode/src/server.ts` — Replace duplicated server logic with `src/shared/ide-server.ts` or keep a thin VS Code wrapper around the shared server.
- Modify: `vscode/src/lock-file.ts` — Use shared lock-file helpers while preserving VS Code-specific workspace-folder collection.
- Create: `src/nvim/sidecar.ts` — Node sidecar entrypoint that bridges Neovim stdin messages to the existing WebSocket protocol.
- Create: `src/nvim/sidecar-schema.ts` — Runtime validation for Neovim-to-sidecar stdin messages.
- Create: `scripts/build-nvim-sidecar.mjs` — esbuild bundle script producing a dependency-contained CommonJS sidecar for Neovim plugin installs.
- Create: `nvim/lua/pi_x_ide/init.lua` — Neovim plugin setup, sidecar lifecycle, snapshot extraction, debounced autocmd publishing, commands, and optional keymap.
- Create: `nvim/plugin/pi-x-ide.lua` — Lightweight plugin loader that exposes commands without forcing startup when users do not call `setup()`.
- Create: `nvim/doc/pi-x-ide.txt` — Neovim help page for setup, commands, keymaps, and troubleshooting.
- Create: `nvim/bin/pi-x-ide-nvim-sidecar.cjs` — Generated bundled sidecar artifact committed or packaged for direct Neovim execution.
- Modify: `package.json` — Include Neovim files in package artifacts, add `neovim`/`nvim` keywords, add sidecar build script to the main build.
- Modify: `tsconfig.json` — Ensure `src/nvim/**/*.ts` is compiled; current `src/**/*.ts` include already covers this unless a separate bundle-only config is preferred.
- Modify: `README.md` — Document Neovim support, installation, setup, commands, and feature parity.
- Modify: `README.zh.md` — Add matching Chinese documentation.
- Modify: `docs/specs/ide-protocol.md` — Document `source: "nvim"` and the lock-file naming convention for Neovim.
- Test: `test/nvim-sidecar.test.ts` — Unit-test sidecar message validation, lock-file creation data, initialize response, and notification forwarding.
- Test: `test/shared.test.ts` — Add coverage for `IdeSource` schema acceptance of `nvim`.
- Test: `nvim/test/pi_x_ide_spec.lua` — Headless Neovim tests for snapshot extraction and mention formatting.

## Recommended Direction

Build the Neovim integration as a **Lua plugin + bundled Node sidecar**.

This is preferable to adding a new Pi-side Msgpack-RPC transport because the current project already has a well-tested lock-file discovery and WebSocket protocol. It is also preferable to implementing a WebSocket server in Lua because WebSocket framing/auth/cleanup would be brittle and duplicate existing Node-side behavior.

A smaller Pi-only `$NVIM` polling integration is possible when Pi is launched from `:terminal`, but it cannot reliably support Pi launched from another terminal and tends to query the terminal buffer instead of the last editor buffer unless a plugin caches state anyway. If we need full IDE parity, the plugin + sidecar design is the clean path.

## Tasks

### Task 1: Extend the Shared Protocol for Neovim

**Outcome:** `nvim` is a first-class IDE source that can flow through discovery, schema validation, UI rendering, prompt context injection, and range mention formatting.

**Files:**

- Modify: `src/shared/protocol.ts`
- Modify: `src/shared/schema.ts`
- Modify: `docs/specs/ide-protocol.md`
- Test: `test/shared.test.ts`

**Steps:**

- [ ] Change `IdeSource` from `"vscode" | "zed" | "unknown"` to `"vscode" | "zed" | "nvim" | "unknown"`.
- [ ] Update `isIdeSource()` to accept `"nvim"`.
- [ ] Add a `docs/specs/ide-protocol.md` note that Neovim uses the same protocol version and writes lock files named `nvim-<pid>-<port>.lock`.
- [ ] Add a test asserting `parseLockFileContent()` accepts a lock file with `ide: "nvim"` and rejects an unsupported source string.
- [ ] Add a test asserting `isEditorSelectionSnapshot()` accepts `source: "nvim"`.

**Validation:**

- Run: `mise run typecheck`
- Expected: TypeScript accepts the new `IdeSource` union everywhere.
- Run: `mise run test`
- Expected: Existing shared tests pass and new `nvim` schema cases pass.

### Task 2: Extract Shared WebSocket and Lock-File Utilities

**Outcome:** VS Code and Neovim sidecar can both use the same authenticated WebSocket server and lock-file writer without protocol drift.

**Files:**

- Create: `src/shared/ide-server.ts`
- Create: `src/shared/lock-file.ts`
- Modify: `vscode/src/server.ts`
- Modify: `vscode/src/lock-file.ts`
- Test: `test/nvim-sidecar.test.ts`

**Steps:**

- [ ] Move the generic parts of `vscode/src/server.ts` into `src/shared/ide-server.ts` as an `IdeWebSocketServer` class that accepts `{ ide, name, version, authToken, getInitialSelection }`.
- [ ] Keep `verifyClient` behavior unchanged: require the `x-pi-x-ide-authorization` header to equal the generated auth token.
- [ ] Keep initialize behavior unchanged: respond with `{ protocolVersion: 1, server: { name, version, ide } }` and immediately send the latest `selection_changed` or `selection_cleared` notification.
- [ ] Move generic helpers from `vscode/src/lock-file.ts` into `src/shared/lock-file.ts`: `createAuthToken()`, atomic `writeIdeLockFile()`, `removeIdeLockFile()`, and a parameterized `createLockFilePath(source, port)`.
- [ ] Preserve lock directory mode `0700` and lock file mode `0600`.
- [ ] Update VS Code files to call the shared helpers while still collecting VS Code workspace folders via `vscode.workspace.workspaceFolders`.
- [ ] Add tests for lock-file path creation with `source: "nvim"`, auth token shape, and atomic write parseability using `PI_X_IDE_LOCK_DIR` test overrides.

**Validation:**

- Run: `mise run typecheck`
- Expected: Root and VS Code TypeScript both compile.
- Run: `mise run test`
- Expected: Existing VS Code-related behavior still passes through shared helpers.

### Task 3: Implement the Neovim Sidecar

**Outcome:** A standalone Node process can receive Neovim snapshots over stdin, publish the existing pi-x-ide lock file, accept Pi WebSocket clients, and broadcast protocol-compatible notifications.

**Files:**

- Create: `src/nvim/sidecar.ts`
- Create: `src/nvim/sidecar-schema.ts`
- Create: `test/nvim-sidecar.test.ts`

**Steps:**

- [ ] Implement a sidecar CLI that accepts JSON config through argv or the first stdin line: `workspaceFolders`, `rangeFormat`, `name`, and optional `lockDir` for tests.
- [ ] Generate an auth token and start the shared `IdeWebSocketServer` on `127.0.0.1` port `0`.
- [ ] Write `nvim-<process.pid>-<port>.lock` with `ide: "nvim"`, `name: "Neovim"`, `transport: "ws"`, `host: "127.0.0.1"`, `port`, `authToken`, `workspaceFolders`, and timestamps.
- [ ] Parse newline-delimited JSON messages from stdin with these shapes:
  - `{ "type": "selection_changed", "snapshot": EditorSelectionSnapshot }`
  - `{ "type": "selection_cleared", "reason": "no-active-editor" }`
  - `{ "type": "at_mentioned", "snapshot": EditorSelectionSnapshot, "rangeText": string }`
  - `{ "type": "workspace_changed", "workspaceFolders": string[] }`
  - `{ "type": "shutdown" }`
- [ ] Keep the latest valid selection in memory so new Pi clients receive an initial snapshot after `initialize`.
- [ ] On `workspace_changed`, rewrite the existing lock file with updated `workspaceFolders` and `updatedAt`.
- [ ] On `selection_changed`, broadcast the JSON-RPC `selection_changed` notification with `source: "nvim"` and `receivedAt` if missing.
- [ ] On `selection_cleared`, broadcast `selection_cleared` with `source: "nvim"`.
- [ ] On `at_mentioned`, broadcast `at_mentioned` with `rangeText` and cache the same snapshot.
- [ ] Remove the lock file on stdin close, `shutdown`, `SIGINT`, `SIGTERM`, and normal process exit.
- [ ] Throw or log a concise stderr error for malformed sidecar messages, but keep the process alive for later valid messages.

**Validation:**

- Run: `mise run test`
- Expected: `test/nvim-sidecar.test.ts` can start the sidecar against a temp lock dir, connect via WebSocket with the auth header, initialize successfully, and observe forwarded selection notifications.

### Task 4: Build and Package the Bundled Sidecar

**Outcome:** Neovim users can run the sidecar from the plugin checkout without installing root `node_modules` manually.

**Files:**

- Create: `scripts/build-nvim-sidecar.mjs`
- Create/generated: `nvim/bin/pi-x-ide-nvim-sidecar.cjs`
- Modify: `package.json`
- Modify: `.prettierignore` if the generated bundle should not be formatted.

**Steps:**

- [ ] Add an esbuild script that bundles `src/nvim/sidecar.ts` into `nvim/bin/pi-x-ide-nvim-sidecar.cjs`, targeting Node 26 and CommonJS.
- [ ] Bundle `ws` and local shared modules into the output so the sidecar can run from a Neovim plugin checkout without `pnpm install`.
- [ ] Make the output executable on POSIX platforms when the filesystem supports chmod.
- [ ] Update the root `build` script so it runs TypeScript compile, sidecar bundle, and VS Code compile.
- [ ] Add `nvim` and `neovim` to package keywords.
- [ ] Update `files` to include `nvim/lua`, `nvim/plugin`, `nvim/doc`, and `nvim/bin` in npm artifacts.

**Validation:**

- Run: `mise run build`
- Expected: `dist/` is built, `vscode/out/` is built, and `nvim/bin/pi-x-ide-nvim-sidecar.cjs` exists.
- Run: `node nvim/bin/pi-x-ide-nvim-sidecar.cjs --help`
- Expected: The sidecar prints usage or exits cleanly without writing a stale lock file.

### Task 5: Implement the Neovim Lua Plugin

**Outcome:** Neovim can start the sidecar, track current file/selection, expose attach commands, and optionally install a user-configured keymap.

**Files:**

- Create: `nvim/lua/pi_x_ide/init.lua`
- Create: `nvim/plugin/pi-x-ide.lua`
- Create: `nvim/doc/pi-x-ide.txt`
- Test: `nvim/test/pi_x_ide_spec.lua`

**Steps:**

- [ ] Implement `require("pi_x_ide").setup(opts)` with options:
  - `enabled = true`
  - `sidecar_cmd = nil` to default to `node <plugin_root>/nvim/bin/pi-x-ide-nvim-sidecar.cjs`
  - `debounce_ms = 150`
  - `range_format = "comma" | "dash"`, default `"comma"`
  - `keymap = nil`, with docs showing `<C-A-k>` or `<leader>pa` as examples
  - `workspace_folders = nil`, defaulting to Neovim cwd plus active LSP workspace folders when available
- [ ] Start the sidecar with `vim.fn.jobstart()` using `stdin = "pipe"`; keep the job id in plugin state.
- [ ] Send an initial config message containing workspace folders immediately after job start.
- [ ] Register `:PiXIdeStart`, `:PiXIdeStop`, `:PiXIdeStatus`, and `:PiXIdeAttach` user commands.
- [ ] Register autocmds in one augroup for `VimEnter`, `BufEnter`, `WinEnter`, `CursorMoved`, `CursorMovedI`, `ModeChanged`, `TextChanged`, `TextChangedI`, `DirChanged`, and `VimLeavePre`.
- [ ] Debounce high-frequency autocmds so the plugin sends at most one snapshot per `debounce_ms` window.
- [ ] Skip non-file buffers where `vim.bo[buf].buftype ~= ""` or `vim.api.nvim_buf_get_name(buf) == ""`.
- [ ] When focus is on terminal/help/quickfix buffers, preserve the last file snapshot instead of replacing it with a terminal buffer.
- [ ] Build file snapshots using `vim.api.nvim_buf_get_name(buf)` for absolute paths and workspace matching from the configured folder list.
- [ ] For no active selection, send `ranges: []` so Pi can display the open file context.
- [ ] For active visual mode, compute the selected region from `vim.fn.getpos("v")` and `vim.fn.getpos(".")`.
- [ ] For recently completed visual selections, compute from marks `'<` and `'>` only when the selection changed during the current plugin session; avoid resurrecting stale marks on startup.
- [ ] Use `vim.api.nvim_buf_get_text()` for selected text. Account for Neovim indexing: rows are 0-based, start columns are byte offsets, end row is inclusive, and end column is exclusive.
- [ ] Convert Neovim byte columns to protocol character offsets with `vim.str_utfindex(line, "utf-16", byte_col, false)` so `selection.start.character` and `selection.end.character` stay compatible with the existing VS Code/LSP convention.
- [ ] For linewise visual mode, select from column `0` to the UTF-8 byte length of the final selected line.
- [ ] For visual-block mode, emit one `SelectionRange` per selected line using the block start/end byte columns.
- [ ] Implement `format_range_mention(snapshot)` in Lua to match TypeScript `formatRangeMention()` for comma and dash formats.
- [ ] `:PiXIdeAttach` should send an `at_mentioned` sidecar message using the latest file snapshot and notify the user with the exact `@path#Lx,y` text.
- [ ] If the sidecar exits unexpectedly, show one warning via `vim.notify()` and allow `:PiXIdeStart` to restart it.
- [ ] On `VimLeavePre` and `:PiXIdeStop`, send `shutdown`, close stdin if available, and clear plugin timers.

**Validation:**

- Run: `nvim --headless -u NONE -c 'set rtp+=.' -l nvim/test/pi_x_ide_spec.lua`
- Expected: Lua tests pass for open-file snapshot, charwise selection, linewise selection, visual-block multi-range selection, Chinese/emoji column conversion, stale mark avoidance, mention formatting, and command registration.

### Task 6: Wire Pi Behavior and Commands Without Special-Case Drift

**Outcome:** Existing `/ide` behavior works for Neovim lock files without a parallel command path.

**Files:**

- Modify: `src/pi/index.ts` only if needed for Neovim-specific status copy.
- Modify: `src/pi/commands.ts` only if docs or status messages require source-specific wording.
- Test: `test/shared.test.ts`
- Test: `test/nvim-sidecar.test.ts`

**Steps:**

- [ ] Verify that `discoverIdeCandidates()` needs no changes after `IdeSource` accepts `nvim`; it should already scan all `.lock` files and sort by workspace match.
- [ ] Verify that `IdeConnection` needs no changes because server identity is returned through the existing initialize result.
- [ ] Verify that `setLatestSelection()`, `clearLatestSelection()`, `formatEditorContext()`, `/ide attach`, and UI status work with `source: "nvim"`.
- [ ] Do not add Neovim to `discoverInstallCandidates()` in this first release; instead document manual plugin installation.
- [ ] If `/ide install` is run while only Neovim is detected, keep the existing VS Code-family message or update it to explicitly say Neovim installation is manual.

**Validation:**

- Run: `mise run test`
- Expected: Existing VS Code and Zed tests pass, and Neovim lock-file discovery connects through the same path.

### Task 7: Document Neovim Installation and Usage

**Outcome:** Users can install the Neovim plugin, start Pi, verify connection, attach selections manually, and troubleshoot sidecar failures.

**Files:**

- Modify: `README.md`
- Modify: `README.zh.md`
- Create or modify: `nvim/doc/pi-x-ide.txt`
- Modify: `docs/specs/ide-protocol.md`

**Steps:**

- [ ] Add a README section titled `Neovim Editor Support` after the Zed section.
- [ ] Document a `lazy.nvim` example:
  ```lua
  {
    "balaenis/pi-x-ide",
    rtp = "nvim",
    config = function()
      require("pi_x_ide").setup({
        keymap = "<C-A-k>",
      })
    end,
  }
  ```
- [ ] Document a native package install example using `pack/*/start` for users not using `lazy.nvim`.
- [ ] Document commands: `:PiXIdeStart`, `:PiXIdeStop`, `:PiXIdeStatus`, `:PiXIdeAttach`.
- [ ] Document that `:PiXIdeAttach` is equivalent to the VS Code `Ctrl+Alt+K` manual attach flow and sends `@relative/path#Lx,y` to connected Pi clients.
- [ ] Document that Pi can be started from any terminal in the same workspace; it does not have to run inside Neovim as long as the plugin sidecar is running.
- [ ] Add Neovim to the feature parity table with real-time push for file/selection tracking and manual attach via user-configured keymap.
- [ ] Add troubleshooting notes for missing Node.js, sidecar not executable, no matching workspace, no lock file under `~/.pi/pi-x-ide`, and keymap conflicts.
- [ ] Mirror the English README changes in `README.zh.md`, keeping a single space around English/code terms in Chinese prose.

**Validation:**

- Run: `mise run format:check`
- Expected: README tables, Lua snippets, and docs are formatted consistently.

### Task 8: Full Validation and Manual Smoke Test

**Outcome:** The implementation is buildable, tested, documented, and manually verified against a real Neovim instance.

**Files:**

- Modify: Any file touched by fixes found during validation.

**Steps:**

- [ ] Run root type checking.
- [ ] Run root tests.
- [ ] Run lint.
- [ ] Run formatting check.
- [ ] Open this repo in Neovim with the plugin enabled.
- [ ] Run `:PiXIdeStatus` and confirm the sidecar is running.
- [ ] Confirm `ls -l ~/.pi/pi-x-ide` shows `nvim-<pid>-<port>.lock`.
- [ ] Start Pi in the same repo with the local extension: `pi -e ./src/pi/index.ts`.
- [ ] Confirm Pi shows `IDE: nvim ✓` in the widget/status.
- [ ] Select text in Neovim and confirm Pi updates to `pending` with the expected file/range.
- [ ] Run `:PiXIdeAttach` or the configured keymap and confirm Pi input receives `@relative/path#Lx,y`.
- [ ] Submit a Pi prompt and confirm selected text appears in the LLM context and the widget changes to `sent`.

**Validation:**

- Run: `mise run typecheck && mise run test && mise run lint && mise run format:check`
- Expected: All commands exit 0.

## Final Validation

- Run: `mise run build`
- Expected: Root TypeScript, bundled Neovim sidecar, and VS Code extension build successfully.
- Run: `mise run typecheck && mise run test && mise run lint && mise run format:check`
- Expected: Type checking, unit tests, lint, and formatting all pass.
- Run: `nvim --headless -u NONE -c 'set rtp+=.' -l nvim/test/pi_x_ide_spec.lua`
- Expected: Headless Neovim plugin tests pass.
- Manual: Neovim plugin running + Pi local extension connected through `nvim-*.lock`.
- Expected: Pi displays `IDE: nvim ✓`, receives live selection updates, and `:PiXIdeAttach` inserts the expected `@file#Lx,y` mention.

## Rollout Notes

- Ship this as manual Neovim plugin support first. Do not claim `/ide install` installs Neovim support until a dedicated installer exists.
- Keep protocol version `1`; the public JSON-RPC message shapes are unchanged.
- The sidecar must bind only to `127.0.0.1`, use a random auth token, write `0600` lock files, and remove stale lock files on shutdown.
- If users install the Neovim plugin from GitHub instead of npm, the bundled `nvim/bin/pi-x-ide-nvim-sidecar.cjs` must be present in the repository or release artifact.
- For npm releases, include Neovim runtime files and the bundled sidecar in `files` so `pi install npm:pi-x-ide` and Neovim plugin installs can reference the same codebase.

## Risks and Mitigations

- Sidecar distribution is the highest-risk part — Bundle the sidecar with esbuild into `nvim/bin/pi-x-ide-nvim-sidecar.cjs` so users do not need root `node_modules`.
- Neovim visual selection semantics are subtle — Cover charwise, linewise, blockwise, reversed selection, Chinese text, and emoji in headless tests.
- Stale visual marks can leak old selections — Track whether marks changed during the current session and send `ranges: []` for ordinary cursor movement instead of blindly reusing startup marks.
- Autocmd spam can hurt editor responsiveness — Debounce updates and compare snapshot keys before writing to the sidecar.
- Workspace mismatch could attach context from a different project — Send cwd and LSP workspace folders, let Pi's existing longest-path matching choose the correct lock file, and document manual `/ide` selection for unusual layouts.
- Node missing in Neovim environment — `:PiXIdeStatus` should report the exact command failure and docs should show how to set `sidecar_cmd` to an absolute Node path.
- Windows/WSL path differences may need follow-up — Initial plugin should report Neovim's absolute paths as seen by the running Neovim process; add path normalization later only if real Windows/WSL testing shows mismatches.
