# Protocol reference

Pi × IDE connects Pi to an IDE through a local WebSocket discovered by lock files.
This page is a quick reference; for exact field semantics, message shapes, and the
full specification, see [`docs/specs/ide-protocol.md`](../specs/ide-protocol.md).

## Lock files

- **Directory:** `~/.pi/pi-x-ide/lock/` (mode `0700`)
- **Naming:** `<ide>-<pid>-<port>.lock` - for example `vscode-12345-48123.lock`,
  `nvim-98765-50001.lock`, `jetbrains-4242-51234.lock`
- **Permissions:** files are mode `0600`, written atomically (temp file + rename)

A lock file advertises the WebSocket endpoint, an auth token, workspace folders,
and timestamps.

## Transport

- **Protocol:** WebSocket (`ws://host:port`)
- **Wire format:** JSON-RPC 2.0

## Authentication

Pi connects with the header:

```text
x-pi-x-ide-authorization: <authToken>
```

The token is a 64-character hex string (`randomBytes(32)`) generated per IDE
session and written to the lock file. The server rejects connections with missing
or invalid tokens.

## Handshake

Pi sends an `initialize` request with its `cwd`; the IDE responds with server info
and immediately sends an initial `selection_changed` or `selection_cleared`
notification.

## Notifications

| Method                     | Sent when                                                            |
| -------------------------- | -------------------------------------------------------------------- |
| `selection_changed`        | The active editor or selection changes.                              |
| `selection_cleared`        | There is no active local text editor (JetBrains).                    |
| `at_mentioned`             | The user invokes an IDE attach-selection command.                    |
| `diagnostic_fix_requested` | The user picks a Pi Quick Fix on a diagnostic (VS Code-family only). |

Line and character offsets are zero-based, matching VS Code/LSP. Neovim converts
byte columns to UTF-16 character offsets; JetBrains derives character offsets from
UTF-16 code-unit counts.

## TUI behavior

When connected, Pi shows:

- A footer status line via `ctx.ui.setStatus("pi-x-ide", ...)`.
- A below-editor widget via `ctx.ui.setWidget("pi-x-ide", ...)` with the IDE,
  workspace, file, range, and `pending` / `sent` attach state.

The widget intentionally does not display selected text content.

## Full specification

See [`docs/specs/ide-protocol.md`](../specs/ide-protocol.md) for the complete
lock file schema, the WSL2 discovery and host-resolution rules, and the exact
JSON for every notification. For the design rationale behind the per-editor
transports, see [Architecture](../explanation/architecture.md).
