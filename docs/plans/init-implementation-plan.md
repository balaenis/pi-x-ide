# Pi x IDE 初始化实现计划

> 来源草稿：`docs/drafts/init.md`  
> 参考分析：`/home/julian/workspace/source/opencode/docs/analysis/ide-interaction--active-file-and-selection.md`  
> 阶段范围：先实现 VS Code 通信；Zed / 其他 IDE 作为后续阶段。

## 1. 文档目标与假设

本文先对草稿做分析和补充，再给出可执行的阶段 1 实现计划。

- **目标读者**：负责实现该扩展包的开发者。
- **用户目标**：让 Pi 在 TUI 中自动或手动获得 IDE 当前活跃文件与选中文本上下文。
- **实现边界**：阶段 1 只交付 VS Code 端；跨 IDE 协议要预留扩展点，但不实现 Zed。
- **关键约束**：WebSocket lock file 必须放在 `~/.pi/pi-x-ide`。

## 2. 草稿分析与头脑风暴补充

### 已明确的需求

1. 创建一个 Pi 扩展包，用于连接 IDE。
2. 获取 IDE 当前编辑文件与选中文本。
3. 将选中文本附加到用户提示上下文。
4. 支持手动快捷键，将选中文本范围引用插入 Pi TUI 输入框。
5. 根据 Pi 启动目录与 IDE workspace root 自动匹配。
6. 支持 `/ide` 命令切换当前通信 IDE。
7. 成功连接 IDE 后，在 Pi TUI 中实时显示连接状态、当前文件、选区范围和附加状态。
8. 阶段 1 先做 VS Code。

### 需要补齐的设计点

| 缺口                                       | 补充方案                                                                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| 通信协议未定义                             | 采用 JSON-RPC 风格的 WebSocket 协议，IDE 端为 server，Pi 端为 client。                                                          |
| Lock file 格式未定义                       | 定义版本化 JSON lock file，包含 `ide`、`port`、`authToken`、`workspaceFolders`、`pid`、`updatedAt`。                            |
| 自动附加如何进入 Pi 上下文未定义           | 优先使用 Pi `context` 事件做非破坏式注入，避免把选中文本永久写进用户消息。                                                      |
| 手动 `@path#L...` 是否由 Pi 原生解析不确定 | 扩展自身解析并补充上下文；输入框中的 `@...` 只作为用户可见引用。                                                                |
| 多 IDE / 多 workspace 选择规则未定义       | 采用最长 workspace 路径匹配 + lock file 更新时间排序，并提供 `/ide` 手动切换。                                                  |
| 大段选中文本风险未定义                     | 对自动注入内容设置大小上限与截断提示。                                                                                          |
| TUI 实时反馈未定义                         | 使用 `ctx.ui.setStatus()` 显示紧凑连接态，使用 `ctx.ui.setWidget()` 展示当前文件、选区范围、`pending` / `sent` 状态和更新时间。 |
| 安全模型未定义                             | lock 目录 `0700`，lock 文件 `0600`，WebSocket 使用随机 token 鉴权。                                                             |
| 快捷键冲突未定义                           | VS Code 的 `Ctrl+Shift+K` 默认是 Delete Line；建议默认 `Ctrl+Alt+K`，并允许用户改成草稿示例。                                   |

## 3. 从 OpenCode 方案迁移的设计决策

OpenCode 有三条路径：

1. **HTTP 主动注入**：VS Code 快捷键向 TUI HTTP endpoint 追加 `@file#Lx-Ly`。
2. **WebSocket + lock file**：IDE 自动推送当前文件与选区，TUI 通过 lock file 发现并连接。
3. **Zed SQLite 轮询**：直接读 Zed 本地数据库。

本项目阶段 1 的取舍：

- 采用路径 2 作为主架构：实时、可扩展、支持自动匹配。
- 手动快捷键不引入额外 HTTP server，而是复用同一条 WebSocket，发送 `at_mentioned` 通知。
- OpenCode 的 `synthetic` message part 在 Pi 中没有等价公开 API；Pi 侧改用 `context` 事件临时注入编辑器上下文。
- Zed SQLite 路径暂不实现，只在协议中保留 `ide` / `source` 字段。

## 4. 目标架构

```text
VS Code Extension
  ├─ 读取 activeTextEditor / selections
  ├─ 启动 localhost WebSocket server
  ├─ 写入 ~/.pi/pi-x-ide/*.lock
  └─ 推送 selection_changed / at_mentioned

          WebSocket + token auth
                    │
                    ▼

Pi Extension Package
  ├─ 扫描 ~/.pi/pi-x-ide/*.lock
  ├─ 根据 ctx.cwd 自动匹配 IDE workspace
  ├─ 维护当前 IDE 连接与最新 selection snapshot
  ├─ 在 TUI footer/widget 实时显示连接状态、文件和范围
  ├─ /ide 命令列出、切换、禁用连接
  ├─ 自动将 selection 注入 LLM context
  └─ 手动把 @path#Lx,y 插入 TUI 输入框
```

## 5. Lock file 协议

默认目录：`~/.pi/pi-x-ide`。

文件名建议：`vscode-{pid}-{port}.lock`。

```json
{
  "version": 1,
  "ide": "vscode",
  "name": "Visual Studio Code",
  "transport": "ws",
  "host": "127.0.0.1",
  "port": 48123,
  "authToken": "random-hex-token",
  "workspaceFolders": ["/home/user/project"],
  "pid": 12345,
  "createdAt": "2026-06-09T00:00:00.000Z",
  "updatedAt": "2026-06-09T00:00:00.000Z"
}
```

规则：

- VS Code extension 启动时创建 lock file，退出时删除。
- 写入时使用临时文件 + rename，避免 Pi 读到半截 JSON。
- Pi 发现时忽略无法解析、端口不可连、进程不存在或过期的 lock file。
- 匹配时只接受 workspace 与 `ctx.cwd` 存在父子包含关系的候选，避免跨项目污染。

## 6. WebSocket 消息协议

采用 JSON-RPC 2.0 风格，但阶段 1 只需要少量 request / notification。

### Pi → IDE

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": 1,
    "client": { "name": "pi-x-ide", "version": "0.1.0" },
    "cwd": "/home/user/project"
  }
}
```

### IDE → Pi: `selection_changed`

```json
{
  "jsonrpc": "2.0",
  "method": "selection_changed",
  "params": {
    "source": "vscode",
    "filePath": "/home/user/project/src/main.ts",
    "workspaceFolder": "/home/user/project",
    "ranges": [
      {
        "text": "const x = 1;",
        "selection": {
          "start": { "line": 9, "character": 0 },
          "end": { "line": 9, "character": 12 }
        }
      }
    ]
  }
}
```

位置规则：协议内部使用 VS Code / LSP 风格的 0-based `line` 和 `character`；展示和文件引用格式转换为 1-based 行号。

### IDE → Pi: `at_mentioned`

手动快捷键触发，用于插入可见文件范围引用。

```json
{
  "jsonrpc": "2.0",
  "method": "at_mentioned",
  "params": {
    "source": "vscode",
    "filePath": "/home/user/project/src/main.ts",
    "workspaceFolder": "/home/user/project",
    "rangeText": "@src/main.ts#L10,20",
    "ranges": [
      {
        "text": "...selected text...",
        "selection": {
          "start": { "line": 9, "character": 0 },
          "end": { "line": 19, "character": 3 }
        }
      }
    ]
  }
}
```

兼容性：解析器同时接受 `#L10,20` 和 `#L10-L20`；默认输出格式可通过配置决定。

## 7. 核心行为流程

### 7.1 自动发现和连接

1. Pi extension 在 `session_start` 扫描 lock 目录。
2. 过滤不合法 lock file。
3. 计算 `ctx.cwd` 与每个 `workspaceFolders` 的匹配分数。
4. 选择最具体且最新的 lock file。
5. 使用 `authToken` 连接 `ws://127.0.0.1:{port}`。
6. 连接成功后发送 `initialize`。
7. 在 TUI footer / status 显示 `IDE: vscode connected`。

### 7.2 自动捕获选中文本

1. VS Code 监听：
   - `window.onDidChangeActiveTextEditor`
   - `window.onDidChangeTextEditorSelection`
2. 事件 debounce 约 `150ms`。
3. 读取 `activeTextEditor.document.uri.fsPath`、workspace folder、非空 selections、每段 selected text。
4. 通过 `selection_changed` 推送给 Pi。
5. Pi 保存最新 snapshot，并标记为 `pending`。
6. Pi 立即刷新 TUI status/widget，让用户看到当前文件和选区范围。

### 7.3 实时 TUI 状态展示

连接 IDE 后，Pi TUI 需要持续展示当前 IDE 上下文，避免用户不确定“当前会附加什么”。

- 使用 `ctx.ui.setStatus("pi-x-ide", ...)` 在 footer 中显示紧凑状态，例如 `IDE: vscode ✓ src/main.ts#L10,20 pending`。
- 使用 `ctx.ui.setWidget("pi-x-ide", ...)` 展示更完整的多行状态：IDE 名称、workspace、相对文件路径、选区范围、附加状态、最近更新时间。
- 状态更新触发点包括：连接成功、断开、重连、`/ide` 切换、`selection_changed`、`at_mentioned`、`agent_end`。
- Widget 默认只显示文件和范围等元信息，不显示选中文本正文，避免把敏感代码长期暴露在界面上。
- 当 `/ide off` 或连接断开时，清理或降级显示为 `IDE: disconnected`。

### 7.4 自动附加到提示上下文

1. 用户提交普通提示时，Pi 在 `before_agent_start` 冻结当前 pending selection snapshot。
2. 在当前 agent turn 的每次 `context` 事件中，向消息列表临时插入一条隐藏 `pi-x-ide` context message。
3. `agent_end` 后清除本 turn snapshot，并把 selection 标记为 `sent`。
4. 如果用户没有选中文本，仅打开文件，则默认只附加文件路径提示；是否附加全文不在阶段 1 实现。

上下文格式建议：

````markdown
<system-reminder>
The user selected lines 10-20 from `src/main.ts` in VS Code. This may or may not be relevant.

```ts
...selected text...
```

</system-reminder>
````

### 7.5 手动快捷键附加

1. VS Code command 读取当前选区。
2. 格式化 range mention：`@src/main.ts#L10,20`。
3. 通过 WebSocket 发送 `at_mentioned`。
4. Pi 收到后调用 `ctx.ui.pasteToEditor(rangeText)`，把引用插入当前 TUI 输入框。
5. 同时缓存该 range 对应的 selected text；用户提交时，即使 Pi 原生不认识 line range，扩展也能把对应文本附加到上下文。

> 注意：`Ctrl+Shift+K` 在 VS Code 默认删除当前行。建议阶段 1 默认使用 `Ctrl+Alt+K`，文档说明用户可在 VS Code keybindings 中改成 `Ctrl+Shift+K`。

### 7.6 `/ide` 命令

注册 Pi command：`pi.registerCommand("ide", ...)`。

建议子命令：

| 命令          | 行为                                      |
| ------------- | ----------------------------------------- |
| `/ide`        | 打开 TUI 选择器，列出可用 IDE 连接。      |
| `/ide status` | 显示当前连接、workspace、最近 selection。 |
| `/ide list`   | 列出 lock 目录中的候选连接。              |
| `/ide auto`   | 重新按 cwd 自动匹配并连接。               |
| `/ide off`    | 断开并关闭自动附加。                      |
| `/ide attach` | 手动把最新 selection range 插入输入框。   |

## 8. 建议文件结构

```text
.
├── package.json
├── tsconfig.json
├── src
│   ├── shared
│   │   ├── protocol.ts
│   │   ├── paths.ts
│   │   ├── format.ts
│   │   └── schema.ts
│   └── pi
│       ├── index.ts
│       ├── discovery.ts
│       ├── connection.ts
│       ├── context.ts
│       ├── ui.ts
│       └── commands.ts
├── vscode
│   ├── package.json
│   ├── tsconfig.json
│   └── src
│       ├── extension.ts
│       ├── server.ts
│       ├── selection.ts
│       └── lock-file.ts
└── docs
    ├── drafts
    │   └── init.md
    ├── plans
    │   └── init-implementation-plan.md
    └── specs
        └── ide-protocol.md
```

Pi package manifest 建议：

```json
{
  "name": "pi-x-ide",
  "keywords": ["pi-package"],
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*"
  },
  "dependencies": {
    "ws": "^8.0.0"
  },
  "pi": {
    "extensions": ["./src/pi/index.ts"]
  }
}
```

VS Code extension 的 `package.json` 独立放在 `vscode/` 下，包含 command、keybinding、activation 与 build scripts。

## 9. 实现阶段计划

### 阶段 0：项目脚手架

- 创建 root `package.json`、`tsconfig.json`。
- 创建 `src/shared`、`src/pi`、`vscode/src`。
- 加入 `ws`、TypeScript、测试工具。
- 配置 Pi package manifest。

验收：`npm test` / `npm run typecheck` 能跑通空项目。

### 阶段 1：共享协议与路径工具

- 定义 lock file 类型与消息类型。
- 实现 schema 校验。
- 实现 `resolveLockDir()`，默认 `~/.pi/pi-x-ide`，支持测试环境覆盖。
- 实现 workspace matching：父子包含关系 + 最长路径 + mtime tie-breaker。
- 实现 range mention formatter / parser。

验收：覆盖路径匹配、range 格式、lock file 解析的单元测试。

### 阶段 2：VS Code extension server

- 在 `activate()` 中启动 WebSocket server。
- 生成 auth token，写 lock file。
- 监听 workspace 变化并刷新 lock file。
- 监听 active editor / selection 变化，debounce 后广播 `selection_changed`。
- 实现 `pi-x-ide.attachSelection` command，发送 `at_mentioned`。
- 在 `deactivate()` 删除 lock file 并关闭 server。

验收：打开 VS Code 后能看到 `~/.pi/pi-x-ide/*.lock`；选择文本时 fake client 能收到消息。

### 阶段 3：Pi extension discovery 和连接

- `session_start` 扫描 lock file 并自动连接。
- 实现 token 鉴权连接 header。
- 实现 initialize handshake。
- 实现断线重连与重新发现。
- 用 `ctx.ui.setStatus()` 显示紧凑连接状态。
- 用 `ctx.ui.setWidget()` 实时显示 IDE 名称、workspace、相对文件路径、选区范围和 `pending` / `sent` 状态。

验收：从匹配 cwd 启动 Pi 后自动连上 VS Code；不匹配项目不会连接；TUI footer/widget 会随连接、断开、文件切换、选区变化实时更新。

### 阶段 4：自动上下文注入

- 保存最新 selection snapshot。
- `before_agent_start` 冻结本 turn 的 pending selection。
- `context` 事件临时插入隐藏 editor context message。
- `agent_end` 清理本 turn 状态，并把 TUI 附加状态从 `pending` 更新为 `sent`。
- 加入大小上限、截断提示、重复发送去重。

验收：提交提示时模型上下文包含选中文本；同一 selection 不会在同一 turn 内重复注入。

### 阶段 5：手动插入和 `/ide` 命令

- 收到 `at_mentioned` 后用 `ctx.ui.pasteToEditor()` 插入 range mention。
- 缓存 mention 对应 selected text，用户提交时附加上下文。
- 实现 `/ide`、`/ide status`、`/ide list`、`/ide auto`、`/ide off`、`/ide attach`。

验收：快捷键能把 `@path#L10,20` 插入 TUI；`/ide` 能切换多个候选连接。

### 阶段 6：文档与打包

- 写 `docs/specs/ide-protocol.md`。
- 写本地开发说明：如何加载 Pi extension、如何用 VS Code Extension Development Host 测试。
- 写用户说明：安装、快捷键、`/ide` 命令、配置项。
- 打包 VS Code extension，验证 Pi package 本地安装。

验收：按文档从零启动 VS Code + Pi，可以完成自动捕获和手动插入流程。

## 10. 验证清单

- [ ] VS Code extension 激活后创建 lock file。
- [ ] lock file 权限与内容正确。
- [ ] Pi 只连接 cwd 匹配的 IDE workspace。
- [ ] 切换活跃文件后 Pi status 更新。
- [ ] TUI widget 实时显示当前 IDE、workspace、相对文件路径、行号范围和 `pending` / `sent` 状态。
- [ ] 选中文本后提交普通提示，LLM context 包含该文本。
- [ ] 无选中文本时只附加打开文件提示，不读全文件。
- [ ] 手动快捷键能插入 `@path#Lx,y`。
- [ ] `/ide list` 显示所有候选。
- [ ] `/ide off` 后不再自动附加。
- [ ] stale lock file 不会导致连接卡死。
- [ ] 大选区被截断并带提示。

## 11. 主要风险与处理

| 风险                                                                  | 处理                                                                                                     |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Pi `context` 事件插入 `custom` message 的 provider 序列化行为需要验证 | 阶段 4 先做 spike；若不可用，退回 `before_agent_start` hidden custom message。                           |
| `@path#Lx,y` 可能被 Pi 原生路径解析误判                               | 扩展在 `input` / turn snapshot 中自行注入真实 selected text；必要时将可见 mention 转义或改为纯文本标签。 |
| VS Code 快捷键冲突                                                    | 默认使用非冲突快捷键，并文档说明如何改成 `Ctrl+Shift+K`。                                                |
| 多 workspace 路径映射复杂                                             | 阶段 1 仅支持本地或远端同文件系统路径；不同机器路径映射后续加配置。                                      |
| 大选区导致上下文膨胀                                                  | 默认截断上限，保留路径和行号，提示用户可手动扩大范围。                                                   |
| TUI 状态过度占屏                                                      | Footer 保持单行，widget 只展示 IDE、workspace、文件、范围和状态；默认不显示选中文本正文。                |
| 多 Pi 实例连接同一 VS Code                                            | IDE server 允许多 client；每个 Pi 根据 cwd 自行过滤。                                                    |

## 12. 阶段 1 完成定义

阶段 1 完成时，应满足：

1. VS Code 端能稳定发布当前活跃文件与选区。
2. Pi 端能通过 `~/.pi/pi-x-ide` lock file 自动发现并连接匹配的 VS Code workspace。
3. 用户提交提示时，当前选中文本能自动进入模型上下文。
4. 用户可以通过快捷键把 range mention 插入 Pi TUI 输入框。
5. Pi TUI 实时展示 IDE 连接、当前文件、选区范围和上下文附加状态。
6. `/ide` 可以查看、切换、断开当前 IDE 连接。
7. 有协议文档、开发文档和最小自动化测试覆盖核心路径。
