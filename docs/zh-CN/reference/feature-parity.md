# 功能对比

各编辑器集成支持的能力。

| 功能                                      | VS Code              | Zed     | Neovim                   | JetBrains            |
| ----------------------------------------- | -------------------- | ------- | ------------------------ | -------------------- |
| 实时文件追踪                              | ✅ 实时推送          | ✅ 轮询 | ✅ 通过 sidecar 实时推送 | ✅ 实时推送          |
| 实时选区追踪                              | ✅ 实时推送          | ✅ 轮询 | ✅ 通过 sidecar 实时推送 | ✅ 实时推送          |
| IDE 上下文 attach 快捷键                  | ✅ 默认 `Ctrl+Alt+K` | ❌      | ✅ 自定义快捷键 keymap   | ✅ 默认 `Ctrl+Alt+K` |
| Pi TUI attach 快捷键（默认 `Ctrl+Alt+K`） | ✅                   | ✅      | ✅                       | ✅                   |
| LLM 上下文注入                            | ✅                   | ✅      | ✅                       | ✅                   |
| `/ide auto`                               | ✅                   | ✅      | ✅                       | ✅                   |
| 诊断 Quick Fix                            | ✅                   | ❌      | ❌                       | ❌                   |
| 自动安装                                  | ✅ 仅 VS Code 系列   | N/A     | ❌                       | ❌                   |

## 注意

- **Zed** 没有扩展 API，文件和选区追踪基于轮询（默认 1000 ms）。见 [架构](../explanation/architecture.md#zed-轮询)。
- **Neovim** 用 sidecar 进程承载 WebSocket 服务器；attach 快捷键在 Lua 插件中配置，不继承自 Pi。见 [安装 Neovim 插件](../how-to/install-neovim.md)。
- **诊断 Quick Fix** 和 **自动安装** 是 VS Code 系列功能。
- **WSL2** 跨边界发现对所有写 lock file 的编辑器（VS Code 系列、Neovim、JetBrains）均可用，Zed 则通过其 Windows 数据库路径支持。见 [在 WSL2 中使用](../how-to/use-wsl2.md)。
