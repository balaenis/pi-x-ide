# `/ide` 命令参考

Pi × IDE 在 Pi TUI 中注册 `/ide` 命令族，用于管理 IDE 连接。

| 命令           | 行为                                                |
| -------------- | --------------------------------------------------- |
| `/ide`         | 打开 TUI 选择器，列出可用 IDE 连接。                |
| `/ide status`  | 显示当前连接、workspace 和最近选区。                |
| `/ide list`    | 列出 lock 目录中的候选连接。                        |
| `/ide auto`    | 重新按 cwd 自动匹配，匹配成功时连接。               |
| `/ide off`     | 断开并关闭自动上下文附加。                          |
| `/ide attach`  | 手动把最新选区范围插入输入框。                      |
| `/ide install` | 通过支持的 IDE CLI 安装或更新 `balaenis.pi-x-ide`。 |

## 附加快捷键

Pi 默认在 TUI 中注册 `Ctrl+Alt+K`，作为 `/ide attach` 的快捷键。重复按下会把最新选中的范围追加到当前输入框，因此可以在编辑器中多次选择不同文本并逐个附加。

- **macOS：** 这是终端快捷键（`Ctrl+Option+K`）。`Cmd` 快捷键通常由终端或系统处理，Pi TUI 无法接收。
- **自定义：** 设置 `PI_X_IDE_ATTACH_SHORTCUT` 为其他 pi key id。
- **禁用：** 设置 `PI_X_IDE_ATTACH_SHORTCUT` 为 `off`、`none`、`false` 或 `0`。

完整环境变量参考见 [配置](configuration.md)。
