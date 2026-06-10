# Zed 编辑器集成分析报告

> **更新 2026-06-10**：新增第 4 章——OpenCode 的 SQLite 直读方案（**推荐**，零侵入、纯 TypeScript）。

---

## 目录

- [方案 A：SQLite 数据库直读（推荐）](#4-方案-asqlite-数据库直读推荐)
- [方案 B：LSP 桥接（备用）](#5-方案-blsp-桥接备用)
- [方案对比](#7-方案对比)
- [结论](#9-结论)

---

## 1. Zed 扩展开发方式（背景知识）

### 1.1 核心架构：Rust → WASM（WIT 组件模型）

Zed 扩展与 VS Code 扩展有本质区别。**没有 JavaScript/TypeScript 支持**——扩展必须用 Rust 编写，编译为 WebAssembly（目标 `wasm32-wasip2`），运行在 Zed 的 WASM 沙箱内。

```
extension.toml       → 扩展清单（类似 package.json）
src/lib.rs           → Rust 源码，编译为 WASM
Cargo.toml           → Rust 依赖声明
```

### 1.2 WIT 接口能力清单

Zed 通过 WIT 定义扩展可用的 API：

| 能力              | 说明                                                         |
| ----------------- | ------------------------------------------------------------ |
| `language-server` | 启动 LSP 服务器（`language_server_command`），配置初始化选项 |
| `context-server`  | 提供 MCP 服务器，供 Zed Agent Panel 使用                     |
| `dap`             | 调试适配器协议                                               |
| `slash-command`   | 自定义斜杠命令（`/xxx` 触发）                                |
| `http-client`     | HTTP 请求                                                    |
| `process`         | 执行原生二进制                                               |
| `nodejs`          | 查询 Node.js 路径、NPM 包信息                                |
| `download-file`   | 下载并缓存文件                                               |
| `worktree`        | 获取工作树根路径、读取文件内容                               |
| `project`         | 获取项目 worktree ID 列表                                    |

### 1.3 关键限制：缺少编辑器状态访问 API

| Zed 缺少的能力                      | VS Code 对应 API                                |
| ----------------------------------- | ----------------------------------------------- |
| 获取当前活跃编辑器/文件路径         | `vscode.window.activeTextEditor`                |
| 监听文本选区变化                    | `vscode.window.onDidChangeTextEditorSelection`  |
| 监听编辑器生命周期事件              | `vscode.window.onDidChangeActiveTextEditor`     |
| 获取选中文本内容                    | `editor.document.getText(selection)`            |
| 在 WASM 沙箱内启动 WebSocket 服务器 | 原生 `ws` 包                                    |
| 注册快捷键                          | `vscode.commands.registerCommand` + keybindings |

> **注意**：以上 API 缺口是 Zed 社区已知问题，[GitHub 讨论 #53131](https://github.com/zed-industries/zed/discussions/53131) 明确讨论了这一需求。

---

## 2. pi-x-ide 现有文本交互逻辑

### 2.1 整体架构

```
┌──────────┐  WebSocket   ┌─────────────────┐  Lock File    ┌─────────┐
│ VS Code  │◄────────────►│  pi-x-ide (pi    │◄────────────►│  Pi CLI │
│ Extension│              │  npm package)    │  Discovery    │ (agent) │
└──────────┘              └─────────────────┘               └─────────┘
     │                          │
     │  推送事件:                │  上下文注入:
     │  - selection_changed     │  - formatEditorContext()
     │  - selection_cleared     │  - at_mentioned → paste
     │  - at_mentioned          │
```

### 2.2 协议层核心类型 (`src/shared/protocol.ts`)

```typescript
export type IdeSource = "vscode" | "zed" | "unknown"; // "zed" 已预定义

export interface EditorSelectionSnapshot {
  source: IdeSource;
  filePath: string;
  workspaceFolder?: string;
  ranges: SelectionRange[]; // { text, selection: { start, end } }
  receivedAt?: number;
}
```

### 2.3 关键模块

| 模块   | 文件            | 职责                                                 |
| ------ | --------------- | ---------------------------------------------------- |
| 发现   | `discovery.ts`  | 扫描 `~/.pi/pi-x-ide/` 下 `.lock` 文件，路径匹配排序 |
| 连接   | `connection.ts` | WebSocket 客户端，JSON-RPC 握手                      |
| 上下文 | `context.ts`    | `formatEditorContext()` → 注入到 LLM 用户消息        |
| 安装   | `install.ts`    | 自动安装 VS Code/Cursor/Windsurf 扩展                |
| 路径   | `paths.ts`      | `isPathInsideOrEqual()`、`relationshipMatchLength()` |

---

## 3. 两种可行方案概述

| 方案                                   | 机制                           | 实时性              | 需要 Zed 扩展？ | 需要原生二进制？ | 复杂度            |
| -------------------------------------- | ------------------------------ | ------------------- | --------------- | ---------------- | ----------------- |
| **A: SQLite 直读** (OpenCode 方案)     | 读取 Zed 本地 SQLite 数据库    | 近实时（1s 轮询）   | ❌              | ❌               | **低**（纯 TS）   |
| **B: LSP 桥接** (claude-code-zed 方案) | Zed 扩展启动 LSP+WS 原生二进制 | 按需（code action） | ✅              | ✅               | 高（Rust + WASM） |

**推荐方案 A**——OpenCode 已在生产环境验证，零侵入、纯 TypeScript、与 pi-x-ide 现有架构完美融合。

---

## 4. 方案 A：SQLite 数据库直读（推荐）

### 4.1 原理

Zed 编辑器在运行期间将工作区状态实时写入本地 SQLite 数据库。**无需安装任何扩展**，Pi 终端进程直接读取该数据库文件即可获取：

- 活跃编辑器及文件路径
- 选中文本范围（UTF-8 字节偏移）
- 缓冲区完整内容
- 工作区路径（用于匹配当前项目）

### 4.2 SQLite 数据库位置

```typescript
// Linux
~/.local/share/zed/db/0-stable/db.sqlite

// macOS
~/Library/Application Support/Zed/db/0-stable/db.sqlite
```

可通过环境变量 `PI_X_IDE_ZED_DB` 覆盖。

### 4.3 数据库关键表

| 表名                | 用途               | 关键字段                                                                      |
| ------------------- | ------------------ | ----------------------------------------------------------------------------- |
| `workspaces`        | 工作区             | `workspace_id`, `paths`（JSON 数组或换行分隔）, `timestamp`                   |
| `panes`             | 窗格               | `pane_id`, `workspace_id`, `active`                                           |
| `items`             | 编辑器/Terminal 项 | `item_id`, `workspace_id`, `pane_id`, `kind`（"Editor"/"Terminal"）, `active` |
| `editors`           | 编辑器缓冲区       | `item_id`, `workspace_id`, `buffer_path`, `contents`                          |
| `editor_selections` | 选中范围           | `editor_id`, `workspace_id`, `start`, `end`（UTF-8 字节偏移）                 |

### 4.4 三阶段查询

**阶段 1：查询活跃编辑器**

```sql
SELECT i.kind AS item_kind,
       e.item_id AS editor_id,
       i.workspace_id,
       w.paths AS workspace_paths,
       w.timestamp,
       e.buffer_path
FROM items i
JOIN panes p ON p.pane_id = i.pane_id AND p.workspace_id = i.workspace_id
JOIN workspaces w ON w.workspace_id = i.workspace_id
LEFT JOIN editors e ON e.item_id = i.item_id AND e.workspace_id = i.workspace_id
WHERE i.active = 1 AND p.active = 1
ORDER BY w.timestamp DESC
```

- `i.active = 1 AND p.active = 1`：锁定当前活跃窗格中的活跃项
- `LEFT JOIN editors`：排除 Terminal 等非编辑器项（`item_kind !== "Editor"`）
- 对结果按 `workspace_paths` 与当前 `cwd` 做**路径匹配打分**，取最佳匹配

**路径匹配算法**（可复用现有 `isPathInsideOrEqual()`）：

```typescript
function scoreZedWorkspace(workspacePaths: string | null, cwd: string): number {
  const paths = parseZedWorkspacePaths(workspacePaths); // JSON 数组或换行分隔
  return paths.reduce((score, wsPath) => {
    if (isPathInsideOrEqual(wsPath, cwd)) {
      return Math.max(score, resolve(wsPath).length);
    }
    return score;
  }, 0);
}
```

**阶段 2：查询选中范围**

```sql
SELECT start AS selection_start, end AS selection_end
FROM editor_selections
WHERE editor_id = $editorID AND workspace_id = $workspaceID
```

**阶段 3：查询缓冲区内容**

```sql
SELECT contents FROM editors
WHERE item_id = $editorID AND workspace_id = $workspaceID
```

- 优先从 `contents` 列获取；为空时降级到 `fs.readFileSync(buffer_path, "utf8")`

### 4.5 UTF-8 字节偏移转换（关键）

Zed 存储的偏移是 **UTF-8 字节偏移**，需转换为 `{line, character}` 坐标：

```typescript
function utf8ByteOffsetToStringIndex(text: string, byteOffset: number): number {
  const encoder = new TextEncoder();
  let bytes = 0;
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i)!;
    const next = i + (cp > 0xffff ? 2 : 1);
    bytes += encoder.encode(text.slice(i, next)).length;
    if (bytes >= byteOffset) return next;
    i = next;
  }
  return text.length;
}
```

### 4.6 轮询策略

```typescript
// 每秒轮询一次，仅在变化时更新
let pollTimer: NodeJS.Timeout | undefined;

function schedulePoll() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(async () => {
    const snapshot = await resolveZedSelection(dbPath, cwd);
    if (snapshot && snapshotKey(snapshot) !== lastKey) {
      lastKey = snapshotKey(snapshot);
      runtime.latestSelection = snapshot;
      runtime.attachState = "pending";
      updateIdeUi(runtime);
    }
    schedulePoll();
  }, 1000);
}
```

- 通过 `snapshotKey()`（已在 `src/shared/format.ts` 中实现）去重
- 与现有 WebSocket 路径共享 `runtime.latestSelection`，无需额外抽象层

### 4.7 Zed 终端环境检测

```typescript
export function isZedTerminal(): boolean {
  return process.env.ZED_TERM === "true" || process.env.TERM_PROGRAM?.toLowerCase() === "zed";
}
```

### 4.8 Pi 端集成清单

| 文件                   | 操作     | 说明                                                        |
| ---------------------- | -------- | ----------------------------------------------------------- |
| `src/pi/editor-zed.ts` | **新增** | SQLite 读取、UTF-8 转换、路径匹配、轮询（约 200 行）        |
| `src/pi/index.ts`      | 修改     | `session_start` 中检测 Zed → 启动轮询                       |
| `src/pi/state.ts`      | 修改     | 新增 `zedPollTimer` 字段                                    |
| `src/shared/paths.ts`  | 复用     | `isPathInsideOrEqual()` 直接用于 workspace 匹配             |
| `src/shared/format.ts` | 复用     | `snapshotKey()`、`toRelativeDisplayPath()`                  |
| `package.json`         | 修改     | 新增 `better-sqlite3` 或使用 `node:sqlite`（Node.js 22.5+） |

**不需要**：新建 `zed/` 工作区、Rust/WASM 代码、原生二进制分发、Zed Marketplace 发布。

### 4.9 数据流

```
Zed 编辑器
    │
    │ SQLite 实时写入
    ▼
~/.local/share/zed/db/0-stable/db.sqlite
    │
    │ 每秒轮询读取
    ▼
┌─ Pi (src/pi/editor-zed.ts) ────────────────────────────┐
│                                                          │
│  resolveZedSelection(dbPath, cwd)                        │
│    → queryZedActiveEditor()       (workspace 匹配)       │
│    → queryZedEditorSelections()   (UTF-8 偏移)           │
│    → queryZedEditorContents()     (缓冲区内容)            │
│    → utf8ByteOffsetToStringIndex() (坐标转换)             │
│    → 返回 EditorSelectionSnapshot                         │
│                                                          │
│  snapshot → runtime.latestSelection                      │
│           → updateIdeUi()                                │
│           → context.ts: formatEditorContext() → LLM       │
└──────────────────────────────────────────────────────────┘
```

### 4.10 关键设计决策

1. **零侵入**：不安装扩展、不修改 Zed 进程，只读 SQLite
2. **路径隔离**：workspace 路径匹配防止多项目污染
3. **降级优先**：WebSocket（VS Code）优先 → SQLite（Zed）降级
4. **复用协议**：`source: "zed"` 已在 `IdeSource` 中定义，`EditorSelectionSnapshot` 完全兼容
5. **选区去重**：`snapshotKey()` 对比，仅在变化时更新
6. **UTF-8 安全**：正确处理多字节字符（中文、emoji 等）

---

## 5. 方案 B：LSP 桥接（备用，源自 claude-code-zed）

### 5.1 架构

```
┌─────────────────┐                    ┌──────────────────────┐
│ Zed Extension   │  language_server   │  原生二进制            │
│ (WASM, Rust)    │──────────────────►│  claude-code-server    │
│ lib.rs          │  command()         │                       │
│ extension.toml  │                    │  ┌─ LSP server (stdin) │
└─────────────────┘                    │  ├─ WS server (TCP)   │
                                       │  └─ MCP handler       │
                                       └──────┬───────────────┘
                                              │ WebSocket
                                       ┌──────┴───────────────┐
                                       │  终端 Agent (Claude)   │
                                       └──────────────────────┘
```

- WASM 扩展注册语言服务器，启动原生二进制
- 原生二进制同时运行 LSP 服务器（与 Zed 通信）和 WebSocket 服务器（与终端 Agent 通信）
- 通过 Tokio broadcast channel 桥接 LSP ↔ WS

### 5.2 选区获取方式（拉取模式）

| 方式                            | 触发条件         | 获取的数据        |
| ------------------------------- | ---------------- | ----------------- |
| `codeAction` 处理器             | 用户打开灯泡菜单 | 当前光标/选区范围 |
| `selectionRange` 处理器         | 语义选择请求     | 光标位置          |
| `completion` 处理器（`@` 触发） | 用户输入 `@`     | 光标位置          |

> **限制**：Zed LSP 不会主动推送选区变化，服务器只能在用户触发特定操作时获取选区信息。

### 5.3 项目结构

```
zed/
├── extension.toml              # Zed 扩展清单
├── Cargo.toml                  # WASM 扩展依赖
├── src/
│   └── lib.rs                  # WASM 入口（~150 行）
├── bin/
│   └── Cargo.toml              # 原生二进制依赖
│   └── src/
│       ├── main.rs             # 入口：hybrid 模式
│       ├── lsp/                # LSP 服务器 (tower-lsp)
│       ├── ws/                 # WebSocket 服务器 (tokio-tungstenite)
│       └── bridge/             # LSP ↔ WS 桥接
```

### 5.4 Pi 端修改

| 文件                     | 操作        | 说明                                |
| ------------------------ | ----------- | ----------------------------------- |
| `src/shared/protocol.ts` | ✅ 无需修改 | `"zed"` 已在 `IdeSource` 中定义     |
| `src/shared/schema.ts`   | ✅ 无需修改 | `"zed"` 已通过 `isIdeSource()` 验证 |
| `src/pi/discovery.ts`    | ✅ 无需修改 | 通用扫描所有 `.lock` 文件           |
| `src/pi/connection.ts`   | ✅ 无需修改 | 协议与 IDE 无关                     |
| `src/pi/context.ts`      | ✅ 无需修改 | `source: "zed"` 已正常处理          |
| `src/pi/install.ts`      | ⚠️ 修改     | 新增 Zed CLI profile（约 30 行）    |

### 5.5 技术栈

| 组件       | 依赖                                                                       |
| ---------- | -------------------------------------------------------------------------- |
| WASM 扩展  | `zed_extension_api`、`serde_json`                                          |
| 原生服务器 | `tower-lsp`、`tokio`、`tokio-tungstenite`、`serde_json`、`tracing`、`clap` |
| 构建工具   | Rust toolchain + `wasm32-wasip2` target                                    |

---

## 6. 方案对比

| 维度           | 方案 A: SQLite 直读（推荐）     | 方案 B: LSP 桥接（备用）               |
| -------------- | ------------------------------- | -------------------------------------- |
| **实时性**     | 近实时（1s 轮询）               | 按需（用户触发 code action）           |
| **选区获取**   | ✅ 每次轮询获取最新选区         | ⚠️ 仅当用户手动触发                    |
| **文件追踪**   | ✅ 实时，buffer_path 精确到文件 | ✅ didOpen/didChange                   |
| **代码量**     | ~200 行 TS                      | ~1500 Rust + ~150 TS                   |
| **构建工具链** | Node.js + TypeScript            | Rust + WASM target + Cargo             |
| **分发复杂度** | 无额外分发                      | macOS/Linux 分别编译 → GitHub Releases |
| **维护成本**   | 低                              | 中                                     |
| **侵入性**     | 零侵入（只读文件）              | 需安装 Zed 扩展                        |

### 为什么推荐方案 A

1. **零依赖**：不需要 Rust 工具链、WASM 编译、原生二进制分发
2. **与现有架构完美融合**：产出与 WebSocket 路径相同的 `EditorSelectionSnapshot`，复用全部 `context.ts`、`format.ts`、`paths.ts` 逻辑
3. **已生产验证**：OpenCode 在 Zed 终端中使用此方案
4. **选区获取更优**：1s 轮询可获取最新选区；方案 B 需用户手动触发
5. **降级自然**：WebSocket 优先 → SQLite 降级，共用同一状态

### 方案 B 适用场景

- Zed 未来提供官方编辑器状态 API 后可在此基础上增强
- 需推送到其他 Zed 实例（非当前终端窗口）
- 需要 Windows 平台支持（SQLite 路径不同，方案 B 无此问题）

---

## 7. 风险评估

### 方案 A 风险

| 风险                  | 影响                       | 缓解措施                                                 |
| --------------------- | -------------------------- | -------------------------------------------------------- |
| SQLite schema 变更    | 表结构或字段名可能变化     | 锁定 Zed stable；查询失败时优雅降级                      |
| 1s 轮询延迟           | 选区变化最多延迟 1s        | 对 LLM 交互场景影响极小                                  |
| 多实例并发读          | 多个 Pi 同时读同一 DB      | SQLite WAL 模式天然支持并发读                            |
| Zed 未运行            | DB 文件不存在              | 路径检测 → 跳过轮询                                      |
| `better-sqlite3` 编译 | npm install 需编译原生模块 | Node.js 22.5+ 内置 `node:sqlite`；或 `sql.js`（纯 WASM） |

### 方案 B 风险

| 风险           | 影响                          | 缓解措施                      |
| -------------- | ----------------------------- | ----------------------------- |
| 无实时选区推送 | 选区仅按需更新                | `didChange` 至少追踪文件      |
| 语言激活依赖   | 只打开支持的文件时 LSP 才启动 | 注册 30+ 种语言 ID            |
| 原生二进制分发 | 多平台编译                    | GitHub Releases 自动构建      |
| Zed API 变更   | WIT 接口可能调整              | 锁定 `zed_extension_api` 版本 |

### 功能对比总览

| 功能         | VS Code      | Zed 方案 A       | Zed 方案 B           |
| ------------ | ------------ | ---------------- | -------------------- |
| 实时文件追踪 | ✅ 推送      | ✅ 1s 轮询       | ⚠️ didOpen/didChange |
| 实时选区追踪 | ✅ 推送      | ✅ 1s 轮询       | ⚠️ code action 触发  |
| @ 引用粘贴   | ✅ WebSocket | ⚠️ 手动 `@path`  | ✅ slash command     |
| 自动连接     | ✅ lock file | ✅ 自动检测→轮询 | ✅ lock file         |
| 扩展安装     | ✅ CLI 一键  | ❌ 不需要扩展    | ⚠️ 手动安装          |
| 多工作区     | ✅           | ✅ 路径匹配      | ✅ workspaceFolders  |
| 代码量       | ~500 TS      | ~200 TS          | ~1500 Rust + 150 TS  |

---

## 8. 结论

**Zed 集成完全可行，推荐方案 A（SQLite 直读）。**

**优势：**

- 零侵入：不需要开发 Zed 扩展、Rust/WASM、原生二进制分发
- 极低代码量：约 200 行 TypeScript，直接融入 `src/pi/`
- 协议兼容：`source: "zed"` 已在 `IdeSource` 中预定义，复用全部上下文注入逻辑
- 已生产验证：OpenCode 使用此方案

**推荐实施顺序（方案 A）：**

1. 新增 `src/pi/editor-zed.ts`：`isZedTerminal()`、`resolveZedDbPath()`、`resolveZedSelection()`、轮询调度
2. 修改 `src/pi/index.ts`：`session_start` 中检测 Zed 终端 → 启动 SQLite 轮询
3. 修改 `src/pi/state.ts`：新增 `zedPollTimer` 字段
4. 可选：添加 `PI_X_IDE_ZED_DB` 环境变量支持
5. 端到端测试
