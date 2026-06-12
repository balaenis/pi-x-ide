# Pi x IDE Protocol

Pi x IDE connects Pi to an IDE through a local WebSocket discovered by lock files.

## Lock files

Directory: `~/.pi/pi-x-ide/lock`.

Example file: `vscode-12345-48123.lock`

Neovim uses the same protocol version and writes files named `nvim-<pid>-<port>.lock`.

```json
{
  "version": 1,
  "ide": "vscode",
  "name": "Visual Studio Code",
  "transport": "ws",
  "host": "127.0.0.1",
  "port": 48123,
  "authToken": "random-hex-token",
  "workspaceFolders": ["/home/user/project"],
  "pid": 12345,
  "createdAt": "2026-06-09T00:00:00.000Z",
  "updatedAt": "2026-06-09T00:00:00.000Z"
}
```

Rules:

- Lock directory should be mode `0700`.
- Lock files should be mode `0600`.
- Writers should write a temp file and rename it into place.
- Pi ignores malformed, stale, unmatched, and dead-process lock files.

## Authentication

Pi connects to `ws://host:port` with the header:

```text
x-pi-x-ide-authorization: <authToken>
```

The IDE server rejects connections with missing or invalid tokens.

## Handshake

Pi sends:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": 1,
    "client": { "name": "pi-x-ide", "version": "0.1.0" },
    "cwd": "/home/user/project"
  }
}
```

IDE responds:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": 1,
    "server": {
      "name": "Pi x IDE VS Code",
      "version": "0.1.0",
      "ide": "vscode"
    }
  }
}
```

## Notifications

### `selection_changed`

Sent whenever the active editor or selection changes.

```json
{
  "jsonrpc": "2.0",
  "method": "selection_changed",
  "params": {
    "source": "vscode",
    "filePath": "/home/user/project/src/main.ts",
    "workspaceFolder": "/home/user/project",
    "ranges": [
      {
        "text": "const x = 1;",
        "selection": {
          "start": { "line": 9, "character": 0 },
          "end": { "line": 9, "character": 12 }
        }
      }
    ],
    "receivedAt": 1780963200000
  }
}
```

`source` is one of `vscode`, `zed`, `nvim`, or `unknown`. `line` and `character` are zero-based, matching VS Code/LSP. Neovim converts byte columns to UTF-16 character offsets before sending snapshots.

### `at_mentioned`

Sent when the user invokes an IDE attach-selection command, such as VS Code's command or Neovim's `:PiXIdeAttach`.

```json
{
  "jsonrpc": "2.0",
  "method": "at_mentioned",
  "params": {
    "source": "vscode",
    "filePath": "/home/user/project/src/main.ts",
    "workspaceFolder": "/home/user/project",
    "rangeText": "@src/main.ts#L10,20",
    "ranges": [
      {
        "text": "selected text",
        "selection": {
          "start": { "line": 9, "character": 0 },
          "end": { "line": 19, "character": 3 }
        }
      }
    ]
  }
}
```

Pi inserts `rangeText` into the TUI editor and caches the corresponding selection text for context injection.

## TUI behavior

When connected, Pi displays:

- Footer status via `ctx.ui.setStatus("pi-x-ide", ...)`.
- A below-editor widget via `ctx.ui.setWidget("pi-x-ide", ...)` with IDE, workspace, file, range, and `pending` / `sent` attach state.

The widget intentionally does not display selected text content.
