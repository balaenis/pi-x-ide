# OpenCode 与 Zed 文本交互调研报告

**调研目标**: OpenCode 如何实现与 Zed 编辑器的文本交互（获取活跃文件、选中文本、文件内容）。

---

## 概述

OpenCode 通过 **三条路径** 获取 IDE 中的活跃文件与选中文本范围，Zed 对应的是 **路径 3**。

| 路径       | 机制                                          | 实时性                 | 适用场景                                           |
| ---------- | --------------------------------------------- | ---------------------- | -------------------------------------------------- |
| 路径 1     | VS Code 扩展 HTTP 注入 `@` 文件引用           | 用户主动触发（快捷键） | VS Code / Cursor                                   |
| 路径 2     | WebSocket + Lock File 发现协议 (JSON-RPC 2.0) | **实时推送**           | VS Code / Cursor / Windsurf / Claude Code 兼容扩展 |
| **路径 3** | **Zed SQLite 数据库直接读取**                 | **近实时（1s 轮询）**  | **Zed 终端**                                       |

Zed 没有提供扩展 API，所以 OpenCode 采用**直接读取 Zed 的 SQLite 数据库文件**的方案，通过轮询数据库获取活跃编辑器的状态。

---

## Files Retrieved

1. `packages/tui/src/editor-zed.ts` (全部 220 行) — **核心**: Zed 专用 SQLite 数据库读取逻辑
2. `packages/tui/src/context/editor.ts` (全部 385 行) — **核心**: EditorContextProvider — 三条路径的统一调度层
3. `packages/tui/src/editor.ts` (全部 100 行) — 编辑器集成入口，导出 `editorIntegration` 对象
4. `packages/tui/src/component/prompt/index.tsx` (lines 120-200, 1030-1100) — TUI 输入组件，格式化编辑器上下文注入 session
5. `packages/opencode/src/acp/content.ts` (lines 140-180) — `zed://` URI 解析为文件引用
6. `packages/opencode/test/cli/tui/editor-context-zed.test.ts` (全部 370 行) — Zed 集成测试用例
7. `sdks/vscode/src/extension.ts` (全部 150 行) — VS Code 扩展（对比参考）
8. `docs/analysis/ide-interaction--active-file-and-selection.md` (全篇) — 官方交互分析文档（中文）

---

## 架构与数据流

### 总览

```
Zed 编辑器运行中
      │
      │ Zed 在 SQLite 数据库中写入：
      │   - workspaces 表 (工作区路径)
      │   - panes 表 (窗格状态)
      │   - items 表 (编辑器/Terminal 项)
      │   - editors 表 (缓冲区路径 + 内容)
      │   - editor_selections 表 (字节偏移选中范围)
      │
      ▼
┌─ OpenCode TUI ──────────────────────────────────────────────┐
│                                                               │
│  EditorContextProvider (context/editor.ts)                     │
│                                                               │
│  发现阶段:                                                     │
│    1. 检查环境变量 CLAUDE_CODE_SSE_PORT / OPENCODE_EDITOR_SSE_PORT │
│    2. 扫描 ~/.claude/ide/*.lock 做 Lock File 发现              │
│    3. 如果上述都不可用，且检测到是 Zed 终端 → 走 Zed 路径       │
│                                                               │
│  连接阶段 (Zed 模式):                                          │
│    → 每 1 秒轮询 connect()                                     │
│    → 每次轮询调用 editor.selection(directory)                  │
│    → 返回结果解码后更新 SolidJS store                          │
│                                                               │
│  运行时:                                                       │
│    store.selection → Reactively 驱动 UI 展示                    │
│    用户提交消息时 → 附加 formatEditorContext() 到 session message │
│                                                               │
└───────────────────────────────────────────────────────────────┘
      │
      ▼
Session Message (附加 system-reminder)
```

### 入口: `editor.ts` 的集成导出

```typescript
// packages/tui/src/editor.ts
export const editorIntegration = {
  connection: discoverEditorConnection, // Lock File 发现 (路径 2)
  selection: (directory: string) => resolveZedSelection(resolveZedDbPath() ?? "", directory), // Zed 路径
};
```

`EditorContextProvider` 接收 `integration` 参数，默认使用 `editorIntegration`。当没有 WebSocket 连接可用时，会检测是否在 Zed 终端中运行，若是则调用 `integration.selection(directory)`。

---

## 核心机制: Zed SQLite 数据库读取

### 1. 检测 Zed 终端环境

```typescript
// editor-zed.ts:198
export function isZedTerminal() {
  return process.env.ZED_TERM === "true" || process.env.TERM_PROGRAM?.toLowerCase() === "zed";
}
```

### 2. 定位 SQLite 数据库文件

```typescript
// editor-zed.ts:182-190
export function resolveZedDbPath() {
  const candidates = [
    process.env.OPENCODE_ZED_DB, // 环境变量覆盖
    path.join(os.homedir(), "Library", "Application Support", "Zed", "db", "0-stable", "db.sqlite"), // macOS
    path.join(os.homedir(), ".local", "share", "zed", "db", "0-stable", "db.sqlite"), // Linux
  ].filter(Boolean);
  return candidates.find((item) => isFile(item));
}
```

### 3. 三阶段查询 (`resolveZedSelection`)

**阶段 1: 查询活跃编辑器** (`queryZedActiveEditor`)

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

- 查找当前活跃（`active=1`）的窗格中的活跃项
- 对每个结果按 `workspace_paths` 与当前工作目录（`cwd`）**路径匹配打分**（匹配路径越长得分越高）
- 按得分降序 + 时间戳降序取最佳匹配
- 结果必须 `item_kind === "Editor"`（排除 Terminal 等）

**路径匹配算法** (`scoreZedWorkspace`):

```typescript
function scoreZedWorkspace(workspacePaths: string | null, cwd: string) {
  return zedWorkspacePaths(workspacePaths).reduce((score, item) => {
    if (pathContains(item, cwd)) return Math.max(score, path.resolve(item).length);
    return score;
  }, 0);
}
```

- `workspace_paths` 可以是 JSON 数组字符串或换行分隔的路径
- `pathContains(parent, child)`: 判断 parent 是否包含 child 路径
- 得分 = 匹配的 workspace 路径长度（越长越具体）
- **防止跨项目上下文污染**: 只有包含当前工作目录的 workspace 才匹配

**阶段 2: 查询选中范围** (`queryZedEditorSelections`)

```sql
SELECT start AS selection_start, end AS selection_end
FROM editor_selections
WHERE editor_id = $editorID AND workspace_id = $workspaceID
```

- 返回的是 **UTF-8 字节偏移量**（byte offsets），不是字符索引
- 支持多个选区（多光标）
- 处理反向选区（`start > end`），统一取 `Math.min`/`Math.max`

**阶段 3: 查询缓冲区内容** (`queryZedEditorContents`)

```sql
SELECT contents FROM editors
WHERE item_id = $editorID AND workspace_id = $workspaceID
```

- 首先尝试从 SQLite 的 `contents` 列获取
- 如果为空，降级到 `fs.readFile(buffer_path, "utf8")` 从磁盘读取

### 4. UTF-8 字节偏移 → 行/列坐标转换

Zed 存储的偏移量是 **UTF-8 字节偏移**，需要转换为 LSP 风格的 `{line, character}` 坐标。

```typescript
// editor-zed.ts:123-137
function utf8ByteOffsetToStringIndex(text: string, byteOffset: number) {
  if (byteOffset <= 0) return 0;
  let bytes = 0;
  for (let index = 0; index < text.length; ) {
    const codePoint = text.codePointAt(index);
    if (codePoint === undefined) return text.length;
    const nextIndex = index + (codePoint > 0xffff ? 2 : 1);
    bytes += utf8.encode(text.slice(index, nextIndex)).length;
    if (bytes >= byteOffset) return nextIndex;
    index = nextIndex;
  }
  return text.length;
}
```

- 使用 `TextEncoder` 逐字符计算 UTF-8 编码字节数
- 正确处理多字节字符（如中文、表情符号）
- 然后通过 `offsetsToSelection` 将字符串索引转为 `{line, character}`（1-based）

---

## 轮询策略

```typescript
// context/editor.ts 中:
const scheduleZedPoll = () => {
  if (closed) return;
  if (reconnect) clearTimeout(reconnect);
  reconnect = setTimeout(connect, 1000); // 每 1 秒轮询一次
};
```

每次轮询流程:

1. 调用 `editor.selection(directory)` → `resolveZedSelection(dbPath, cwd)`
2. 对比新旧 `editorSelectionKey()`，**仅在变化时更新 store**
3. 更新触发 SolidJS 响应式更新，UI 重新渲染

与 Lock File 发现共享 `reconnect` 定时器，避免两种机制冲突。

---

## 数据转换为 Session Message

### TUI 展示

```
> _                                      ✂ main.ts#L10-L20
```

- `editorFileLabel()`: 显示文件名和行号范围
- `editor.labelState()`: `"pending"` | `"sent"` | `"none"`

### 提交时注入

用户按 Enter 提交消息时，在 `submitInner()` 中:

```typescript
const editorParts =
  editorSelection && editor.labelState() === "pending"
    ? [
        {
          type: "text" as const,
          text: formatEditorContext(editorSelection),
          synthetic: true, // 不持久化到消息历史正文
          metadata: {
            kind: "editor_context",
            source: editorSelection.source ?? "editor", // "zed" | "websocket"
            filePath: editorSelection.filePath,
            ranges: editorSelection.ranges,
          },
        },
      ]
    : [];
```

### formatEditorContext 输出

有选中文本时:

````
<system-reminder>Note: The user selected #L10-L12 from "src/main.ts". ```const x = 1
const y = 2```

This may or may not be relevant to the current task.</system-remark>
````

仅有打开文件时:

```
<system-reminder>Note: The user opened the file "src/main.ts". This may or may not be relevant to the current task.</system-reminder>
```

---

## ACP 层的 `zed://` URI 处理

在 `packages/opencode/src/acp/content.ts` 中，OpenCode 也支持解析 `zed://` URI:

```typescript
if (uri.startsWith("zed://")) {
  const pathname = new URL(uri).searchParams.get("path")
  if (pathname) {
    return {
      type: "file",
      url: pathToFileURL(pathname).href,  // 转为 file:// URL
      ...
    }
  }
}
```

这允许 ACP 客户端使用 `zed://workspace?path=/tmp/project/src/app.ts` 格式引用文件。

---

## 关键设计决策

1. **无需 Zed 扩展**: 因为 Zed 不支持扩展（不像 VS Code），OpenCode 直接读取 Zed 的本地 SQLite 数据库，完全不侵入编辑器进程。

2. **路径匹配隔离**: 通过 workspace 路径匹配确保 opencode 实例只捕获同一项目的 Zed 窗口状态，避免多项目污染。

3. **降级友好**: 当 WebSocket（路径 2）不可用时自动降级到 Zed SQLite 轮询（路径 3），再不可用则回退到手动 `@` 引用（路径 1）。

4. **UTF-8 安全**: Zed 存储字节偏移而非字符索引，OpenCode 实现了完整的 UTF-8 多字节解码，支持中文、表情符号等字符。

5. **多光标支持**: 支持 Zed 的多选区功能，将多个 selection 按偏移排序后一并返回。

6. **synthetic 标记**: 编辑器上下文以 `synthetic: true` 附加到消息中，不会持久化到历史记录，每次对话实时获取。

7. **`sent`/`pending` 状态**: 防止编辑器上下文在多次消息中重复注入，发送后自动标记为已发送。

---

## 核心文件索引

| 文件                                                        | 作用                                                                        |
| ----------------------------------------------------------- | --------------------------------------------------------------------------- |
| `packages/tui/src/editor-zed.ts`                            | **Zed 核心** — SQLite 数据库查询、UTF-8 偏移转换、路径匹配                  |
| `packages/tui/src/context/editor.ts`                        | **统一调度层** — WebSocket + Lock File + Zed 三条路径的发现、连接、状态管理 |
| `packages/tui/src/editor.ts`                                | 编辑器集成入口，导出 `editorIntegration` 对象                               |
| `packages/tui/src/component/prompt/index.tsx`               | TUI 输入组件，editor context 展示 + session message 注入                    |
| `packages/opencode/src/acp/content.ts`                      | `zed://` URI 解析为文件引用                                                 |
| `packages/opencode/test/cli/tui/editor-context-zed.test.ts` | Zed 集成测试（含各种字符编码场景）                                          |

---

## 环境变量

| 变量                       | 用途                                           |
| -------------------------- | ---------------------------------------------- |
| `ZED_TERM`                 | 设为 `"true"` 表示在 Zed 终端中运行            |
| `TERM_PROGRAM`             | 设为 `"zed"` 表示在 Zed 终端中运行（降级检测） |
| `OPENCODE_ZED_DB`          | 覆盖 Zed SQLite 数据库路径                     |
| `OPENCODE_EDITOR_SSE_PORT` | WebSocket 端口（TUI 端，优先级 1）             |
| `CLAUDE_CODE_SSE_PORT`     | WebSocket 端口（Claude Code 兼容，优先级 1）   |

---

## Start Here

要理解 OpenCode 如何与 Zed 交互，从以下文件开始:

1. **`packages/tui/src/editor-zed.ts`** — Zed 专用 SQLite 读取逻辑，最核心的 Zed 交互代码
2. **`packages/tui/src/context/editor.ts`** — 统一调度层，理解 Zed 轮询如何与其他路径配合
3. **`packages/tui/src/editor.ts`** — 入口整合，看到 `editorIntegration` 对象的组装
