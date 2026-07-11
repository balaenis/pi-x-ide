# 架构

Pi × IDE 在两个通常互不感知的进程之间搭桥：你的 IDE 和 Pi TUI。本页解释各组件、数据流，以及为什么不同编辑器的连接方式不同。这是面向理解的文档 - 确切的消息结构和字段语义见 [协议规范](../../specs/ide-protocol.md)。

## 三个角色

| 角色          | 谁                                                      | 职责                                                               |
| ------------- | ------------------------------------------------------- | ------------------------------------------------------------------ |
| **IDE 插件**  | VS Code 扩展、JetBrains 插件、Neovim Lua 插件 + sidecar | 观察活跃编辑器和选区，通过本地 WebSocket 暴露它们。                |
| **Lock file** | IDE 插件写入，Pi 读取                                   | 广播 WebSocket 端点（host、port、auth token）和 workspace 文件夹。 |
| **Pi 扩展**   | 加载到 Pi TUI 的 `pi-x-ide`                             | 发现 lock file、建立连接、接收选区、注入为 LLM 上下文。            |

Zed 是例外：它没有插件，Pi 直接读取 Zed 的本地状态数据库。见 [为什么不同编辑器连接方式不同](#为什么不同编辑器连接方式不同)。

## 数据流

```
用户在 IDE 中选中文本
        │
        ▼
┌──────────────────────────────────────────────────────────┐
│ IDE 插件（VS Code / JetBrains / Neovim sidecar）         │
│                                                          │
│  捕获编辑器 + 选区，广播一条                              │
│  JSON-RPC "selection_changed" 通知。                     │
└──────────────────────┬───────────────────────────────────┘
                       │  WebSocket  ws://127.0.0.1:<port>
                       │  认证：x-pi-x-ide-authorization 头
                       ▼
┌──────────────────────────────────────────────────────────┐
│ Pi 扩展  (src/pi/connection.ts)                          │
│                                                          │
│  接收通知，缓存为 runtime.latestSelection，              │
│  置 attachState = "pending"，更新 TUI widget（⇡ 标记）。 │
└──────────────────────┬───────────────────────────────────┘
                       │  下一条用户消息时
                       ▼
┌──────────────────────────────────────────────────────────┐
│ Pi prompt 生命周期  (src/pi/context.ts)                  │
│                                                          │
│  before_agent_start：快照 pending 的选区。               │
│  message_end：包装进 <selected-context> 并               │
│  前置到用户消息。attachState = "sent"。                  │
└──────────────────────────────────────────────────────────┘
```

附加快捷键（TUI 中的 `Ctrl+Alt+K`，或 IDE 的 attach 命令）发送的是 `at_mentioned` 通知。它把 `@file#Lx-Ly` mention 插入 Pi 输入框，并缓存选中文本，为下一轮做好准备。

## 为什么不同编辑器连接方式不同

每个 IDE 的扩展 API 决定了传输方式。

| 编辑器        | 机制                          | 原因                                                                                                                           |
| ------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **VS Code**   | 扩展宿主内的 WebSocket 服务器 | 扩展 API 丰富：`onDidChangeTextEditorSelection`、文件系统访问、终端创建。轻量服务器在进程内运行，无需独立进程。                |
| **JetBrains** | IDE 进程内的 WebSocket 服务器 | 同理：`com.intellij` API 提供编辑器监听和 project service 生命周期。Kotlin 插件在进程内运行服务器。                            |
| **Neovim**    | 独立的 **sidecar** 进程       | Lua 无法原生运行 WebSocket 服务器。sidecar 是独立进程，通过 stdin/stdout（JSON lines）与 Neovim 通信，并向 Pi 暴露 WebSocket。 |
| **Zed**       | **Pi 侧 SQLite 轮询**         | Zed 没有扩展 API，把编辑器状态存在本地 SQLite 数据库中，Pi 每秒直接读取。轮询在 Pi 侧进行，不在 Zed 侧。                       |

### Neovim sidecar

由于 Neovim 无法承载 WebSocket 服务器，Lua 插件会 spawn 一个 sidecar 进程（`src/nvim/sidecar.ts`），由它持有服务器和 lock file。插件通过 Neovim autocmd（`CursorMoved`、`BufEnter`、visual 模式 mark）捕获选区，去抖后把 JSON 消息写入 sidecar 的 stdin。sidecar 再以 JSON-RPC 通知广播给 Pi。

sidecar 的解析顺序（`ide-plugins/nvim/lua/pi_x_ide/download.lua`）：

1. `ide-plugins/nvim/bin/` 中的平台二进制。
2. 从 GitHub Releases 下载并缓存、经 SHA256 校验的二进制。
3. 回退到 Node.js 脚本（`pi-x-ide-nvim-sidecar.cjs`）。

这就是 Neovim 插件首次启动"开箱即用"的原因：它为你的平台下载合适的二进制，下载失败时回退到 Node。

### Zed 轮询

Pi 直接读取 Zed 的状态数据库（`src/pi/zed.ts`）。每次轮询（默认 1000 ms，可通过 `PI_X_IDE_ZED_POLL_INTERVAL_MS` 限制在 100–2000 ms）：

1. 检查 SQLite WAL 文件的 mtime - 未变化则跳过昂贵的读取（在 WSL 下尤为重要，否则每次都要拷贝完整快照）。
2. 通过 join Zed 的 `items`、`panes`、`workspaces`、`editors` 表查询活跃编辑器。
3. 按 workspace 匹配度打分，选出最佳。
4. 把 UTF-8 字节偏移转换为 VS Code/LSP 风格的 line/character 位置。

## 认证模型

每个 IDE 进程每次会话用 `randomBytes(32).toString("hex")` 生成新 token - 64 字符的十六进制串（`src/shared/lock-file.ts`）。JetBrains 用 `SecureRandom` 生成等价 token。token 写入 lock file（mode `0600`），仅在 WebSocket 升级握手时通过 `x-pi-x-ide-authorization` 头发送。服务器的 `verifyClient` 回调会拒绝头不匹配的连接（`src/shared/ide-server.ts`）。

token 除了跨越 WSL 边界外不会离开 localhost - 此时 WebSocket 仍指向解析出的 Windows host。

## 相关

- [发现机制](discovery.md) - Pi 如何找到 lock file 并选择连接。
- [协议规范](../../specs/ide-protocol.md) - 确切的消息结构、握手和通知。
- [功能对比](../reference/feature-parity.md) - 各编辑器支持的能力。
