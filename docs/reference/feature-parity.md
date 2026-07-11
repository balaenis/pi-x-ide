# Feature parity

Capabilities supported by each editor integration.

| Feature                                       | VS Code                 | Zed        | Neovim                        | JetBrains               |
| --------------------------------------------- | ----------------------- | ---------- | ----------------------------- | ----------------------- |
| Live file tracking                            | ✅ Real-time push       | ✅ polling | ✅ Real-time push via sidecar | ✅ Real-time push       |
| Live selection tracking                       | ✅ Real-time push       | ✅ polling | ✅ Real-time push via sidecar | ✅ Real-time push       |
| IDE context attach shortcut                   | ✅ Default `Ctrl+Alt+K` | ❌         | ✅ Custom configured keymap   | ✅ Default `Ctrl+Alt+K` |
| Pi TUI attach shortcut (default `Ctrl+Alt+K`) | ✅                      | ✅         | ✅                            | ✅                      |
| LLM context injection                         | ✅                      | ✅         | ✅                            | ✅                      |
| `/ide auto`                                   | ✅                      | ✅         | ✅                            | ✅                      |
| Diagnostic Quick Fix                          | ✅                      | ❌         | ❌                            | ❌                      |
| Auto-install                                  | ✅ VS Code-family only  | N/A        | ❌                            | ❌                      |

## Notes

- **Zed** has no extension API, so file and selection tracking are polling-based
  (default 1000 ms). See [Architecture](../explanation/architecture.md#zed-polling).
- **Neovim** uses a sidecar process to host the WebSocket server; the attach
  shortcut is configured in the Lua plugin, not inherited from Pi. See
  [Install the Neovim plugin](../how-to/install-neovim.md).
- **Diagnostic Quick Fix** and **auto-install** are VS Code-family features.
- **WSL2** cross-boundary discovery works for all editors that write lock files
  (VS Code-family, Neovim, JetBrains) and for Zed via its Windows database path.
  See [Use Pi × IDE over WSL2](../how-to/use-wsl2.md).
