# Use Pi × IDE with Zed

Zed requires no extension. Pi detects Zed automatically when you run it inside a
Zed terminal and reads Zed's local state database to track the active file and
selection.

## Prerequisites

- The [`pi`](https://github.com/earendil-works/pi-coding-agent) CLI installed.
- The `pi-x-ide` Pi package installed: `pi install npm:pi-x-ide`.
- Zed installed.

## Connect

1. Open a project folder in Zed.
2. Open a terminal in Zed (`Zed -> Terminal -> New Terminal`) and start Pi:

   ```bash
   pi
   ```

Pi detects the Zed environment (`ZED_TERM=true` or `TERM_PROGRAM=zed`) and begins
polling Zed's SQLite database. A widget appears above the Pi input box showing the
active file and selection.

## Verify it works

Open a file in Zed and select some text. The widget should update in real time:

```
⧉ ⇡ foo.ts#L10-L20
```

Focus the Pi TUI and press `Ctrl+Alt+K` (macOS: `Ctrl+Option+K`) to insert the
selection as `@src/foo.ts#L10-L20`, then submit your message.

## How tracking works

Zed has no extension API, so Pi reads its editor state directly from the local
SQLite database. Polling runs every 1000 ms by default and skips a tick when the
database's WAL file has not changed. See
[Architecture](../explanation/architecture.md#zed-polling) for details.

## Configuration

| Environment variable            | Default       | Description                                            |
| ------------------------------- | ------------- | ------------------------------------------------------ |
| `PI_X_IDE_ZED_DB`               | (auto-detect) | Override the path to Zed's SQLite database.            |
| `PI_X_IDE_ZED_POLL_INTERVAL_MS` | `1000`        | Polling interval in milliseconds, clamped to 100–2000. |

Default database paths:

- **Linux:** `~/.local/share/zed/db/0-stable/db.sqlite`
- **macOS:** `~/Library/Application Support/Zed/db/0-stable/db.sqlite`
- **Windows:** `%LOCALAPPDATA%\Zed\db\0-stable\db.sqlite`
- **WSL with Windows Zed:** `/mnt/c/Users/<user>/AppData/Local/Zed/db/0-stable/db.sqlite`

These variables can be set as real environment variables or in
`~/.pi/pi-x-ide/config.json` under `env`. See
[Configuration](../reference/configuration.md).

## Notes

- Zed support is **polling-based**, so the widget updates at most once per poll
  interval rather than on every keystroke.
- The IDE-side attach shortcut (`Ctrl+Alt+K` in VS Code/JetBrains) is not
  available in Zed - use the Pi TUI shortcut instead.
- Diagnostic Quick Fix and auto-install are VS Code-family features and are not
  available for Zed. See the [feature parity](../reference/feature-parity.md)
  table.
