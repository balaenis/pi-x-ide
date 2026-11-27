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
│  message_end：包装进 <selected-context>，再根据           │
│  contextPlacement 放在 prompt 前面或后面。               │
│  attachState = "sent"。                                  │
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

## 启动与 TUI 事件循环

Pi 会等待每个 `session_start` handler 返回后才完成自身初始化，而 TUI 在单线程事件循环被占用时既无法重绘也无法接收输入。两条规则避免让 Pi 显得卡死 —— 在 WSL 下尤其重要，因为 `/mnt/c` 是 9P 挂载，每次调用都是一次往返：

1. **`session_start` 不等待发现/连接完成。** `src/pi/index.ts` 把 `startSession` 作为后台任务启动（`runtime.startupTask`）并立即返回；`session_shutdown` 仍会等待该任务。状态 widget 会先显示 spinner，让等待可见而不是静默卡住。
2. **跨 OS 挂载上不做同步文件操作。** lock 目录、Windows 用户目录（`/mnt/c/Users`）、Zed 数据库和配置文件都使用 `fs/promises` 读取。在这些路径上一旦使用同步 `readdir`、`realpath` 或 `copyFile`，整个 9P 往返期间输入与渲染都会被阻塞。配置读取带缓存并用 `stat` 校验，因此热路径（WSL 判定、发现、widget 更新）不会每次都重新读文件。

发现过程仍是逐个 lock file 串行处理的，且 WSL 下每个 Windows 侧 lock 都要付一次 TCP 探测（500 ms 超时）。陈旧 lock 多了会累加：启动感觉慢时清理 `/mnt/c/Users/<you>/.pi/pi-x-ide/lock/`。

## 认证模型

每个 IDE 进程每次会话用 `randomBytes(32).toString("hex")` 生成新 token - 64 字符的十六进制串（`src/shared/lock-file.ts`）。JetBrains 用 `SecureRandom` 生成等价 token。token 写入 lock file（mode `0600`），仅在 WebSocket 升级握手时通过 `x-pi-x-ide-authorization` 头发送。服务器的 `verifyClient` 回调会拒绝头不匹配的连接（`src/shared/ide-server.ts`）。

token 除了跨越 WSL 边界外不会离开 localhost - 此时 WebSocket 仍指向解析出的 Windows host。

## 相关

- [发现机制](discovery.md) - Pi 如何找到 lock file 并选择连接。
- [Effect 采用说明](effect.md) - Pi 侧 TypeScript 如何在内部用 Effect 处理错误、Schema 校验与 IO 边界。
- [协议规范](../../specs/ide-protocol.md) - 确切的消息结构、握手和通知。
- [功能对比](../reference/feature-parity.md) - 各编辑器支持的能力。
