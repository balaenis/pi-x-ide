# Architecture

Pi × IDE bridges two processes that normally know nothing about each other: your
IDE and the Pi TUI. This page explains the moving parts, the data flow, and why
each editor connects differently. It is understanding-oriented — for exact
message shapes and field semantics, see the
[protocol specification](../specs/ide-protocol.md).

## The three roles

| Role             | Who                                                              | Responsibility                                                                   |
| ---------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **IDE plugin**   | VS Code extension, JetBrains plugin, Neovim Lua plugin + sidecar | Observe the active editor and selection, expose them over a local WebSocket.     |
| **Lock file**    | Written by the IDE plugin, read by Pi                            | Advertise the WebSocket endpoint (host, port, auth token) and workspace folders. |
| **Pi extension** | `pi-x-ide` loaded into the Pi TUI                                | Discover lock files, connect, receive selections, inject them as LLM context.    |

Zed is the exception: it has no plugin, so Pi reads Zed's local state database
directly. See [Why each editor connects differently](#why-each-editor-connects-differently).

## Data flow

```
User selects text in the IDE
        │
        ▼
┌──────────────────────────────────────────────────────────┐
│ IDE plugin (VS Code / JetBrains / Neovim sidecar)        │
│                                                          │
│  Captures editor + selection, broadcasts a               │
│  JSON-RPC "selection_changed" notification.              │
└──────────────────────┬───────────────────────────────────┘
                       │  WebSocket  ws://127.0.0.1:<port>
                       │  Auth: x-pi-x-ide-authorization header
                       ▼
┌──────────────────────────────────────────────────────────┐
│ Pi extension  (src/pi/connection.ts)                     │
│                                                          │
│  Receives the notification, caches it as                 │
│  runtime.latestSelection, marks attachState = "pending", │
│  updates the TUI widget (⇡ marker).                      │
└──────────────────────┬───────────────────────────────────┘
                       │  on next user message
                       ▼
┌──────────────────────────────────────────────────────────┐
│ Pi prompt lifecycle  (src/pi/context.ts)                 │
│                                                          │
│  before_agent_start: snapshots the pending selection.    │
│  message_end: wraps it in <selected-context> and         │
│  prepends it to the user message. attachState = "sent".  │
└──────────────────────────────────────────────────────────┘
```

The attach shortcut (`Ctrl+Alt+K` in the TUI, or the IDE's attach command) sends
an `at_mentioned` notification instead. That inserts the `@file#Lx-Ly` mention
into the Pi input box and caches the selection text so it is ready for the next
turn.

## Why each editor connects differently

Each IDE's extension API dictates the transport.

| Editor        | Mechanism                                  | Reason                                                                                                                                                               |
| ------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **VS Code**   | WebSocket server inside the extension host | Rich extension API: `onDidChangeTextEditorSelection`, file-system access, terminal creation. A lightweight server runs in-process — no separate process needed.      |
| **JetBrains** | WebSocket server inside the IDE process    | Same rationale: the `com.intellij` API provides editor listeners and project-service lifecycle. The Kotlin plugin runs the server in-process.                        |
| **Neovim**    | Separate **sidecar** process               | Lua cannot run a WebSocket server natively. The sidecar is a standalone process that talks to Neovim over stdin/stdout (JSON lines) and exposes the WebSocket to Pi. |
| **Zed**       | **Pi-side SQLite polling**                 | Zed has no extension API. It stores editor state in a local SQLite database, which Pi reads directly every second. The polling runs on the Pi side, not in Zed.      |

### The Neovim sidecar

Because Neovim cannot host a WebSocket server, the Lua plugin spawns a sidecar
process (`src/nvim/sidecar.ts`) that owns the server and the lock file. The
plugin captures selections via Neovim autocmds (`CursorMoved`, `BufEnter`,
visual-mode marks), debounces them, and writes JSON messages to the sidecar's
stdin. The sidecar broadcasts them as JSON-RPC notifications to Pi.

The sidecar is resolved in this order (`ide-plugins/nvim/lua/pi_x_ide/download.lua`):

1. A platform binary bundled in `ide-plugins/nvim/bin/`.
2. A cached binary downloaded from GitHub Releases, verified by SHA256.
3. A fallback Node.js script (`pi-x-ide-nvim-sidecar.cjs`).

This is why the Neovim plugin "just works" on first start: it downloads the right
binary for your platform and falls back to Node if the download is unavailable.

### Zed polling

Pi reads Zed's state database directly (`src/pi/zed.ts`). On each poll (default
1000 ms, clampable to 100–2000 ms via `PI_X_IDE_ZED_POLL_INTERVAL_MS`):

1. Check the SQLite WAL file's mtime — skip the expensive read if nothing changed
   (this matters especially under WSL, where a full snapshot would otherwise be
   copied each tick).
2. Query the active editor by joining Zed's `items`, `panes`, `workspaces`, and
   `editors` tables.
3. Score candidates by workspace match and pick the best.
4. Convert UTF-8 byte offsets to VS Code/LSP-style line/character positions.

## Authentication model

Each IDE process generates a fresh token per session using
`randomBytes(32).toString("hex")` — a 64-character hex string
(`src/shared/lock-file.ts`). JetBrains generates the equivalent with
`SecureRandom`. The token is written to the lock file (mode `0600`) and sent only
during the WebSocket upgrade handshake, in the `x-pi-x-ide-authorization` header.
The server's `verifyClient` callback rejects any connection whose header does not
match (`src/shared/ide-server.ts`).

Tokens never leave localhost except across the WSL boundary, where the WebSocket
still targets the resolved Windows host.

## Related

- [How discovery works](discovery.md) — how Pi finds lock files and picks a
  connection.
- [Protocol specification](../specs/ide-protocol.md) — exact message shapes,
  handshake, and notifications.
- [Feature parity](../reference/feature-parity.md) — which capabilities each
  editor supports.
