# Pi x IDE Protocol

Pi x IDE connects Pi to an IDE through a local WebSocket discovered by lock files.

## Lock files

Directory: `~/.pi/pi-x-ide/lock`.

Example file: `vscode-12345-48123.lock`

Neovim uses the same protocol version and writes files named `nvim-<pid>-<port>.lock`. JetBrains IDEs use the same protocol version and write files named `jetbrains-<pid>-<port>.lock`.

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
  "runningInWindows": false,
  "createdAt": "2026-06-09T00:00:00.000Z",
  "updatedAt": "2026-06-09T00:00:00.000Z"
}
```

Rules:

- Lock directory should be mode `0700`.
- Lock files should be mode `0600`.
- Writers should write a temp file and rename it into place.
- `host` remains required for compatibility, but Pi may resolve a different connection host before opening the WebSocket.
- `runningInWindows` is optional and backward-compatible. When present and `true`, it declares that the IDE server process is running on native Windows.
- A consumer must not remove a lock only because of age after it proves the producer is live.
- A usable local PID is a positive safe integer. When PID checking is enabled, keep a lock with a live usable PID at any age, and remove a lock with a dead usable PID at any age.
- If the PID is missing or unusable, or if PID checking is disabled, use age-only cleanup.
- When Pi runs in WSL and a lock has `runningInWindows: true`, TCP reachability is authoritative while PID checking is enabled. Keep the lock if the host and port are reachable. Remove the lock if the probe fails or throws.
- Malformed lock files remain removable.
- Repository lock producers for VS Code, Neovim, and JetBrains refresh owned locks every 15 minutes while active. Refresh preserves endpoint identity and the auth token, updates freshness data, and can recreate an externally deleted owned lock.
- TypeScript producers drain every accepted refresh before they remove the lock. JetBrains stops its EDT timer synchronously before cleanup.

## WSL2 discovery and host resolution

The primary lock directory is always `~/.pi/pi-x-ide/lock`. When Pi runs inside WSL, it also scans Windows user lock directories such as `/mnt/c/Users/<user>/.pi/pi-x-ide/lock`, skipping Windows system profiles.

For connection hosts, Pi resolves in this order:

1. `PI_X_IDE_HOST_OVERRIDE`, either from the real environment or `~/.pi/pi-x-ide/config.json` `env`.
2. If Pi runs in WSL and the lock has `runningInWindows: true`, parse the WSL default gateway from `ip route show` and use it only if a short TCP probe to `<gateway>:<port>` succeeds.
3. The lock file `host` value.
4. `127.0.0.1` if `host` is empty.

Incoming editor paths are normalized to the Pi host before workspace matching, UI display, `@file#Lx-Ly` mention formatting, and prompt context formatting. Matching WSL UNC paths such as `\\wsl.localhost\Ubuntu\home\user\project` become `/home/user/project` when Pi is running in the `Ubuntu` distro.

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

`source` is one of `vscode`, `zed`, `nvim`, `jetbrains`, or `unknown`. `line` and `character` are zero-based, matching VS Code/LSP. Neovim converts byte columns to UTF-16 character offsets before sending snapshots. JetBrains derives `character` from document offsets and line-start offsets, which are UTF-16 code-unit counts.

JetBrains sends `selection_changed` both for non-empty selections and for an active local file with no selected text (`ranges: []`). It sends `selection_cleared` when there is no active local text editor.

### `at_mentioned`

Sent when the user invokes an IDE attach-selection command, such as VS Code's command, Neovim's `:PiXIdeAttach`, or the JetBrains **Pi x IDE: Attach Selection** action.

```json
{
  "jsonrpc": "2.0",
  "method": "at_mentioned",
  "params": {
    "source": "vscode",
    "filePath": "/home/user/project/src/main.ts",
    "workspaceFolder": "/home/user/project",
    "rangeText": "@src/main.ts#L10-L20",
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

Pi inserts `rangeText` into the TUI editor and caches the corresponding selection text for context injection. JetBrains sends selection and attach notifications in the MVP; it does not send diagnostic Quick Fix notifications.

### `diagnostic_fix_requested`

Sent by the VS Code-family extension when the user selects **Pi: Fix it** or **Pi: Send diagnostic** from Quick Fix on an error or warning diagnostic. This notification is additive under protocol version `1`; clients that do not understand it may ignore it.

```json
{
  "jsonrpc": "2.0",
  "method": "diagnostic_fix_requested",
  "params": {
    "action": "fix",
    "source": "vscode",
    "filePath": "/home/user/project/src/main.ts",
    "workspaceFolder": "/home/user/project",
    "documentVersion": 7,
    "triggerRange": {
      "start": { "line": 9, "character": 4 },
      "end": { "line": 9, "character": 10 }
    },
    "diagnostics": [
      {
        "severity": "error",
        "message": "Type 'string' is not assignable to type 'number'.",
        "source": "ts",
        "code": 2322,
        "range": {
          "start": { "line": 9, "character": 4 },
          "end": { "line": 9, "character": 10 }
        },
        "selectedText": "value",
        "contextLines": [
          { "line": 8, "text": "const value = getValue();", "isPrimary": false },
          { "line": 9, "text": "const count: number = value;", "isPrimary": true },
          { "line": 10, "text": "console.log(count);", "isPrimary": false }
        ]
      }
    ],
    "receivedAt": 1780963200000
  }
}
```

When `action` is `"fix"` or omitted, Pi formats the diagnostics into a prompt and sends it as a user message. If the agent is busy, Pi queues the diagnostic prompt as a follow-up. When `action` is `"send-diagnostic"`, Pi formats only the diagnostic context and pastes it into the TUI input box without starting an agent turn.

## TUI behavior

When connected, Pi displays IDE connection status in one place, selected by
`status_display` (project config overrides global; set via `/ide settings`):

- `widget` (default): above-editor widget via `ctx.ui.setWidget("pi-x-ide", ...)`.
- `statusline`: default footer status line via `ctx.ui.setStatus("pi-x-ide", ...)`.

Both placements show the compact connection/selection state (IDE icon, spinner or
status mark, file, range, and `pending` / `sent` attach state). Selected text
content is intentionally omitted.
