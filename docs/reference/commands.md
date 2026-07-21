# `/ide` command reference

Pi × IDE registers the `/ide` command family in the Pi TUI for managing IDE
connections.

| Command        | Behavior                                                           |
| -------------- | ------------------------------------------------------------------ |
| `/ide`         | Open the TUI selector to list available IDE connections.           |
| `/ide status`  | Show the current connection, workspace, and most recent selection. |
| `/ide list`    | List candidate connections from the lock directory.                |
| `/ide auto`    | Re-attempt automatic matching by `cwd` and connect when matched.   |
| `/ide off`     | Disconnect and disable automatic context attachment.               |
| `/ide attach`  | Manually insert the latest selection range into the input box.     |
| `/ide install` | Install or update `balaenis.pi-x-ide` through a supported IDE CLI. |
| `/ide settings`  | Open IDE settings (`Display`, `AutoInstall`, …).                   |

### `/ide settings`

Unified settings entry. Layout:

```text
Settings:
→ Display       widget      IDE status placement: widget or statusline
  AutoInstall   true        Auto-install VS Code-family extension on startup
```

| Setting       | Values                 | Config key / env            | Default  |
| ------------- | ---------------------- | --------------------------- | -------- |
| `Display`     | `widget` / `statusline` | `status_display`            | `widget` |
| `AutoInstall` | `true` / `false`       | `env.PI_X_IDE_AUTO_INSTALL` | `true`   |

Keybindings:

| Key      | Action                                |
| -------- | ------------------------------------- |
| `↑`/`↓`  | Move between settings                 |
| `Space`  | Cycle the selected setting's value    |
| `Ctrl+S` | Save all settings to global config    |
| `Ctrl+P` | Save all settings to project config   |
| `Esc`    | Cancel without saving                 |

- **Global:** `~/.pi/pi-x-ide/config.json`
- **Project:** `<cwd>/.pi/pi-x-ide/config.json` (overrides global)

`Display` applies immediately in the current Pi session. See
[Configuration](configuration.md).

## The attach shortcut

Pi registers `Ctrl+Alt+K` in the TUI as a shortcut for `/ide attach` by default.
Repeated presses append the latest selected range to the current input, so you can
select multiple ranges in the editor and attach them one by one.

- **macOS:** this is a terminal shortcut (`Ctrl+Option+K`). `Cmd` shortcuts are
  handled by the terminal/OS and are not available to Pi's TUI.
- **Customize:** set `PI_X_IDE_ATTACH_SHORTCUT` to another pi key id.
- **Disable:** set `PI_X_IDE_ATTACH_SHORTCUT` to `off`, `none`, `false`, or `0`.

See [Configuration](configuration.md) for the full environment variable reference.
