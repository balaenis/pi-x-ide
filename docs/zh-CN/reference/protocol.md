# 协议参考

Pi × IDE 通过本地 WebSocket 连接 Pi 和 IDE，连接由 lock file 发现。本页是快速参考；确切字段语义、消息结构和完整规范见 [`docs/specs/ide-protocol.md`](../../specs/ide-protocol.md)。

## lock file

- **目录：** `~/.pi/pi-x-ide/lock/`（权限 `0700`）
- **命名：** `<ide>-<pid>-<port>.lock` - 例如 `vscode-12345-48123.lock`、`nvim-98765-50001.lock`、`jetbrains-4242-51234.lock`
- **权限：** 文件权限 `0600`，原子写入（临时文件 + rename）

lock file 广播 WebSocket 端点、auth token、workspace 文件夹和时间戳。

## 传输

- **协议：** WebSocket（`ws://host:port`）
- **线路格式：** JSON-RPC 2.0

## 认证

Pi 连接时携带头：

```text
x-pi-x-ide-authorization: <authToken>
```

token 是 64 字符的十六进制串（`randomBytes(32)`），每次 IDE 会话生成并写入 lock file。服务器拒绝缺失或无效 token 的连接。

## 握手

Pi 发送带 `cwd` 的 `initialize` 请求；IDE 响应服务器信息，并立即发送初始 `selection_changed` 或 `selection_cleared` 通知。

## 通知

| 方法                       | 触发时机                                           |
| -------------------------- | -------------------------------------------------- |
| `selection_changed`        | 活跃编辑器或选区变化。                             |
| `selection_cleared`        | 无活跃本地文本编辑器（JetBrains）。                |
| `at_mentioned`             | 用户调用 IDE attach 选区命令。                     |
| `diagnostic_fix_requested` | 用户在诊断上选择 Pi Quick Fix（仅 VS Code 系列）。 |

line 和 character 偏移从 0 开始，与 VS Code/LSP 一致。Neovim 把字节列转换为 UTF-16 character 偏移；JetBrains 从 UTF-16 code-unit 计数派生 character 偏移。

## TUI 行为

连接后 Pi 显示：

- 通过 `ctx.ui.setStatus("pi-x-ide", ...)` 的页脚状态行。
- 通过 `ctx.ui.setWidget("pi-x-ide", ...)` 的编辑器下方 widget，显示 IDE、workspace、文件、范围和 `pending` / `sent` attach 状态。

widget 刻意不显示选中文本内容。

## 完整规范

完整 lock file schema、WSL2 发现与 host 解析规则、以及每条通知的确切 JSON 见 [`docs/specs/ide-protocol.md`](../../specs/ide-protocol.md)。各编辑器传输方式的设计理由见 [架构](../explanation/architecture.md)。
