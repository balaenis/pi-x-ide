# JetBrains IDE 接入 pi-x-ide 可行性分析

> 分析日期: 2026-06-21

## 1. 背景

pi-x-ide 是一个 Pi 扩展包，负责将 IDE 中的编辑器选择上下文（当前文件、选中文本范围、诊断信息）实时推送到 Pi TUI，并注入到 LLM 对话上下文中。目前已支持 VS Code、Zed 和 Neovim。

本文档评估将 JetBrains IDE 系列（IntelliJ IDEA、PyCharm、WebStorm、GoLand 等）接入 pi-x-ide 的技术可行性。

## 2. pi-x-ide 架构概述

### 2.1 核心协议

pi-x-ide 使用 **JSON-RPC 2.0 over WebSocket** 作为 IDE 与 Pi 之间的通信协议：

- **传输层**: 本地 WebSocket（`ws://127.0.0.1:<port>`）
- **认证**: 随机 64 字符 hex token，通过 HTTP header `x-pi-x-ide-authorization` 传递
- **发现机制**: Lock file 写入 `~/.pi/pi-x-ide/lock/`，包含 host、port、authToken、workspaceFolders 等信息
- **消息类型**:
  - `initialize` — 握手，交换协议版本和服务器信息
  - `selection_changed` — 编辑器选择变化
  - `selection_cleared` — 编辑器失去焦点
  - `at_mentioned` — 用户主动 attach 选择
  - `diagnostic_fix_requested` — 诊断修复请求（VS Code 特有）

### 2.2 架构角色

```
┌──────────┐  WebSocket Client   ┌──────────────────┐
│   Pi     │ ◄────────────────── │  IDE Extension    │
│ (Node.js)│                     │ (WebSocket Server)│
└──────────┘                     └──────────────────┘
     │                                    │
     │  reads lock file                   │  writes lock file
     ▼                                    ▼
┌─────────────────────────────────────────────────┐
│              ~/.pi/pi-x-ide/lock/               │
│  {ide}-{pid}-{port}.lock (JSON)                 │
└─────────────────────────────────────────────────┘
```

**关键设计原则**：IDE 端运行 WebSocket **Server**，Pi 端作为 **Client** 主动连接。Lock file 是服务发现的唯一媒介。

### 2.3 现有 IDE 插件实现对比

| 维度     | VS Code                                        | Zed                                     | Neovim                               |
| -------- | ---------------------------------------------- | --------------------------------------- | ------------------------------------ |
| 实现语言 | TypeScript                                     | 无需插件（SQLite 轮询）                 | Lua + Node.js sidecar                |
| 通信方式 | WebSocket Server（扩展内）                     | 直接读 Zed SQLite DB                    | WebSocket Server（sidecar 进程）     |
| 选择追踪 | `vscode.window.onDidChangeTextEditorSelection` | 轮询 `editors` + `editor_selections` 表 | Neovim autocmd + `nvim_buf_get_text` |
| 诊断支持 | ✅ Quick Fix provider                          | ❌                                      | ❌                                   |
| 状态栏   | ✅ StatusBarItem                               | ❌                                      | ❌                                   |
| 终端打开 | ✅ `vscode.window.createTerminal`              | ❌                                      | ❌                                   |
| 自动安装 | ✅ `code --install-extension`                  | N/A                                     | lazy.nvim / 手动                     |

## 3. JetBrains Platform 能力映射

### 3.1 技术栈

JetBrains 插件使用 **Kotlin/Java** 开发，基于 IntelliJ Platform SDK。构建系统为 **Gradle** + `intellij-platform-gradle-plugin`。

### 3.2 核心功能映射

#### 3.2.1 编辑器选择追踪 ✅ 完全可行

| pi-x-ide 需求         | JetBrains API                                             |
| --------------------- | --------------------------------------------------------- |
| 监听选择变化          | `SelectionListener` — 注册到 `Editor.getSelectionModel()` |
| 监听光标移动          | `CaretListener` — 注册到 `Editor.getCaretModel()`         |
| 获取选中文本          | `Editor.selectionModel.selectedText`                      |
| 获取文件路径          | `VirtualFile.path` / `CommonDataKeys.VIRTUAL_FILE`        |
| 获取 workspace 根目录 | `ProjectRootManager.getInstance(project).contentRoots`    |
| 全局监听所有编辑器    | `EditorEventMulticaster` 或 `EditorFactoryListener`       |

**示例代码骨架 (Kotlin)**:

```kotlin
class PiXIdeSelectionListener(private val server: PiXIdeWebSocketServer) {
    fun register(project: Project) {
        val connection = project.messageBus.connect(project)
        connection.subscribe(
            FileEditorManagerListener.FILE_EDITOR_MANAGER,
            object : FileEditorManagerListener {
                override fun selectionChanged(event: FileEditorManagerEvent) {
                    broadcastSelection(event.manager)
                }
            }
        )
    }

    private fun broadcastSelection(manager: FileEditorManager) {
        val editor = manager.selectedTextEditor ?: return
        val document = editor.document
        val virtualFile = FileDocumentManager.getInstance().getFile(document) ?: return
        val selection = editor.selectionModel

        val snapshot = EditorSelectionSnapshot(
            source = "jetbrains",
            filePath = virtualFile.path,
            workspaceFolder = getWorkspaceFolder(virtualFile),
            ranges = listOf(
                SelectionRange(
                    text = selection.selectedText ?: "",
                    selection = Selection(
                        start = Position(selection.selectionStart / editor.document.textLength),
                        end = Position(selection.selectionEnd / editor.document.textLength)
                    )
                )
            )
        )
        server.broadcast("selection_changed", snapshot)
    }
}
```

#### 3.2.2 WebSocket Server ✅ 可行

JetBrains 插件内可以启动本地 WebSocket Server：

- **方案 A: Ktor Server** — 轻量级，Kotlin 原生，但需处理 `kotlinx-coroutines` 版本冲突
- **方案 B: Java 标准库 `java.net.http.WebSocket` + `com.sun.net.httpserver`** — 零外部依赖，但 API 较底层
- **方案 C: 嵌入 Jetty/Netty** — 功能强大但引入重量级依赖

**推荐方案 A（Ktor）**，与现有插件生态一致，社区支持好。

#### 3.2.3 Lock File 协议 ✅ 完全可行

Lock file 是纯 JSON 文件，语言无关。JetBrains 插件只需：

1. 启动时生成 auth token（`SecureRandom`）
2. 启动 WebSocket Server 获取端口
3. 写入 lock file 到 `~/.pi/pi-x-ide/lock/jetbrains-{pid}-{port}.lock`
4. 定期刷新 `workspaceFolders` 和 `updatedAt`
5. 插件卸载/IDE 关闭时删除 lock file

Pi 端发现逻辑 **无需任何修改**。

#### 3.2.4 状态栏 Widget ✅ 可行

```kotlin
class PiXIdeStatusBarWidgetFactory : StatusBarWidgetFactory {
    override fun getId() = "pi-x-ide"
    override fun getDisplayName() = "Pi x IDE"
    override fun isAvailable(project: Project) = true

    override fun createWidget(project: Project) = PiXIdeStatusBarWidget(project)
}
```

注册到 `plugin.xml`:

```xml
<statusBarWidgetFactory
    implementation="com.balaenis.pixide.PiXIdeStatusBarWidgetFactory"
    id="pi-x-ide"
    order="last"/>
```

#### 3.2.5 终端打开 ✅ 可行

```kotlin
val widget = TerminalToolWindowManager.getInstance(project).createShellWidget(
    project, "Pi", project.basePath ?: project.name
)
widget.sendCommandToExecute("pi")
widget.show()
```

需要 `org.jetbrains.plugins.terminal` 依赖。

#### 3.2.6 快捷键 ✅ 可行

```xml
<keyboard-shortcut keymap="$default" first-keystroke="ctrl alt K"/>
```

#### 3.2.7 诊断 Quick Fix ⚠️ 可行但实现差异大

JetBrains 的诊断系统与 VS Code 不同：

- **VS Code**: `CodeActionProvider` + `vscode.Diagnostic`
- **JetBrains**: `LocalInspectionTool` + `LocalQuickFix`（基于 PSI 语法树）

映射方案：

- 实现 `IntentionAction`（意图操作），在编辑器右键菜单中显示 "Pi: Fix it" / "Pi: Send diagnostic"
- 读取当前文件的 inspection results，提取错误/警告信息
- 构造与 VS Code 兼容的 `DiagnosticFixRequestedParams` 发送到 Pi

**限制**：JetBrains 的 inspection 结果获取 API 较 VS Code 复杂，需要遍历 `InspectionManager` 和 `GlobalInspectionContext`。

#### 3.2.8 自动安装 ⚠️ 机制不同

VS Code 通过 CLI `code --install-extension` 实现自动安装。JetBrains 没有等效的 CLI 安装机制。

替代方案：

- **方案 A**: 引导用户从 JetBrains Marketplace 安装（与 VS Code "Option A" 一致）
- **方案 B**: 通过 JetBrains Plugin Repository API 检测安装状态
- **方案 C**: 利用 `jetbrains` CLI tool（如果可用）或 IDE 内置的 Plugin Manager API

**建议**：优先 Marketplace 安装 + Pi 端检测 lock file 是否存在来判断连接状态。

## 4. 技术挑战与风险

### 4.1 语言栈差异

| 项目   | pi-x-ide 现有       | JetBrains 插件                           |
| ------ | ------------------- | ---------------------------------------- |
| 语言   | TypeScript          | Kotlin/Java                              |
| 构建   | bun + esbuild + tsc | Gradle + intellij-platform-gradle-plugin |
| 包管理 | npm/bun             | Gradle (Maven Central)                   |
| 运行时 | Node.js             | JVM (IntelliJ Platform)                  |

**影响**：无法复用现有 TypeScript 代码。Lock file 协议和 WebSocket 消息格式需要重新实现，但协议本身简单（JSON-RPC 2.0），实现成本可控。

### 4.2 多 IDE 兼容性

JetBrains 有多个 IDE 产品（IDEA、PyCharm、WebStorm、GoLand 等），它们共享 IntelliJ Platform。

- **好消息**：一个插件可以同时 target 多个 IDE，通过 `plugin.xml` 中的 `<depends>` 配置
- **注意**：不同 IDE 的 API 版本可能不同，需要设置合适的 `since-build` 和 `until-build`
- **建议**：先 target IntelliJ IDEA Community Edition（免费），再扩展到其他 IDE

### 4.3 WebSocket Server 生命周期

VS Code 扩展的 activate/deactivate 生命周期与 JetBrains 的 `projectOpened`/`projectClosed` 不同：

- JetBrains 插件是 **Application 级别**或 **Project 级别**的
- WebSocket Server 应在 project 打开时启动，关闭时停止
- 多个 project 同时打开时，每个 project 应有独立的 server（不同端口）

### 4.4 依赖冲突风险

Ktor 依赖 `kotlinx-coroutines`，可能与 IntelliJ Platform 内置版本冲突。需要：

- 在 `build.gradle.kts` 中 exclude 冲突模块
- 或使用纯 Java WebSocket 实现避免依赖问题

### 4.5 插件分发

- JetBrains Marketplace 需要注册开发者账号
- 插件签名要求（2024+ 版本）
- 版本兼容性矩阵较 VS Code 复杂

## 5. 功能对照表

| 功能                 | VS Code         | Zed        | Neovim       | JetBrains 可行性                  | 备注         |
| -------------------- | --------------- | ---------- | ------------ | --------------------------------- | ------------ |
| 实时文件追踪         | ✅ push         | ✅ polling | ✅ push      | ✅ `FileEditorManagerListener`    |              |
| 实时选择追踪         | ✅ push         | ✅ polling | ✅ push      | ✅ `SelectionListener`            |              |
| IDE 端 attach 快捷键 | ✅ `Ctrl+Alt+K` | ❌         | ✅ 自定义    | ✅ `KeyboardShortcut`             |              |
| Pi 端 attach 快捷键  | ✅              | ✅         | ✅           | ✅ 无需 IDE 改动                  | Pi 端功能    |
| LLM 上下文注入       | ✅              | ✅         | ✅           | ✅ 无需 IDE 改动                  | Pi 端功能    |
| `/ide auto` 自动匹配 | ✅              | ✅         | ✅           | ✅ Lock file 协议不变             |              |
| 状态栏指示器         | ✅              | ❌         | ❌           | ✅ `StatusBarWidgetFactory`       |              |
| 从 IDE 打开 Pi 终端  | ✅              | ❌         | ❌           | ✅ `TerminalToolWindowManager`    |              |
| 诊断 Quick Fix       | ✅              | ❌         | ❌           | ⚠️ `IntentionAction` + Inspection | 实现方式不同 |
| 自动安装扩展         | ✅ CLI          | N/A        | ✅ lazy.nvim | ⚠️ 需 Marketplace 引导            | 无 CLI 安装  |
| 多 workspace 支持    | ✅              | ✅         | ✅           | ✅ `ProjectRootManager`           |              |

## 6. 实现工作量估算

### 6.1 核心功能（MVP）

| 模块                             | 预估工时      | 说明                             |
| -------------------------------- | ------------- | -------------------------------- |
| 项目脚手架 (Gradle + plugin.xml) | 1-2 天        | 标准 IntelliJ 插件模板           |
| WebSocket Server (Ktor)          | 2-3 天        | 含认证、JSON-RPC 编解码          |
| Lock File 管理                   | 1 天          | 创建/刷新/删除 lock file         |
| 编辑器选择追踪                   | 2-3 天        | SelectionListener + 文件路径解析 |
| 状态栏 Widget                    | 1 天          | 连接状态 + 选择状态显示          |
| Attach 快捷键 + 命令             | 1 天          | KeyboardShortcut + Action        |
| Pi 终端打开                      | 0.5 天        | TerminalToolWindowManager        |
| **MVP 合计**                     | **8-11.5 天** |                                  |

### 6.2 进阶功能

| 模块             | 预估工时    | 说明                              |
| ---------------- | ----------- | --------------------------------- |
| 诊断 Quick Fix   | 3-5 天      | IntentionAction + Inspection 集成 |
| 多 IDE 兼容测试  | 2-3 天      | IDEA、PyCharm、WebStorm 等        |
| Marketplace 发布 | 1-2 天      | 签名、审核、CI/CD                 |
| 自动安装检测     | 1 天        | Plugin Repository API             |
| **进阶合计**     | **7-11 天** |                                   |

### 6.3 总计

- **MVP**: 约 2 周
- **完整功能**: 约 3-4 周

## 7. 建议实施路径

### Phase 1: 概念验证（1 周）

1. 创建最小 IntelliJ 插件项目（Gradle + Kotlin）
2. 实现 WebSocket Server + Lock File 写入
3. 实现 SelectionListener 推送选择变化
4. 验证 Pi 端能发现并连接

### Phase 2: MVP（1 周）

5. 添加状态栏 Widget
6. 添加 Attach 快捷键
7. 添加 Pi 终端打开
8. 端到端测试

### Phase 3: 完善（1-2 周）

9. 诊断 Quick Fix
10. 多 IDE 兼容性测试
11. Marketplace 发布准备
12. 文档 + README 更新

## 8. 结论

**JetBrains IDE 接入 pi-x-ide 在技术上是完全可行的。**

核心原因：

1. **Lock file 协议是语言无关的** — Pi 端发现逻辑无需任何修改
2. **JSON-RPC over WebSocket 是通用协议** — Kotlin/Java 生态有成熟的 WebSocket 实现
3. **IntelliJ Platform SDK 提供了所有需要的 API** — 编辑器事件、文件系统、状态栏、终端、快捷键
4. **一个插件可覆盖整个 JetBrains IDE 家族** — IDEA、PyCharm、WebStorm、GoLand 等

主要挑战在于：

- 需要用 Kotlin 重新实现 WebSocket Server 和协议编解码（无法复用 TypeScript 代码）
- 诊断 Quick Fix 的实现方式与 VS Code 差异较大
- 自动安装机制需要适配 JetBrains 生态（无 CLI 安装）

**建议优先级：先做 MVP（选择追踪 + 状态栏 + attach），诊断和自动安装作为后续迭代。**
