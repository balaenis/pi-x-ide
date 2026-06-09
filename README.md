# Pi × IDE

Pi extension package for IDE selection context integration.

VS Code 中打开或选中的文件和文本范围，自动推送到 Pi TUI，并作为对话上下文提交给 LLM。

## 环境依赖

- Node.js ≥ 20
- pnpm ≥ 11（`packageManager` 声明为 `pnpm@11.5.2`）
- VS Code ≥ 1.90（仅 VS Code 扩展需要）
- Pi CLI（`@earendil-works/pi-coding-agent ≥ 0.79`）

## 安装与构建

```bash
pnpm install
pnpm build
```

常用命令：

| 命令 | 说明 |
| --- | --- |
| `pnpm build` | 编译 Pi 侧 TypeScript → `dist/` + VS Code 侧 esbuild bundle → `vscode/out/` |
| `pnpm typecheck` | 类型检查（不产出文件） |
| `pnpm test` | 编译 + 运行单元测试 |
| `pnpm package:vscode` | 打包 VS Code 扩展为 VSIX |
| `pnpm vsix` | `pnpm package:vscode` 的别名 |

## 本地测试 VS Code 扩展

### 方式一：F5 启动 Extension Development Host（推荐）

1. 用 VS Code 打开 **项目根目录**。
2. 进入 **Run and Debug** 面板（`Ctrl+Shift+D`）。
3. 选择 **Run Pi x IDE VS Code Extension**。
4. 按 **F5**：
   - preLaunchTask 会自动执行 `pnpm build`。
   - 打开一个标题包含 `[Extension Development Host]` 的新 VS Code 窗口。

### 方式二：打包 VSIX 后安装

```bash
pnpm package:vscode
code --install-extension pi-x-ide-vscode-0.1.0.vsix
```

这样安装的扩展在所有 VS Code 窗口中运行，不依赖 F5 Extension Host。

### 验证扩展是否运行

```bash
ls -l ~/.pi/pi-x-ide
```

应看到类似 `vscode-12345-48123.lock` 的文件。

如果没有，在 VS Code 中执行 **Developer: Reload Window**。

## 连接 Pi

在 **同一个项目目录** 启动 Pi：

```bash
pi -e ./src/pi/index.ts
```

Pi TUI 应显示：

- Footer：`IDE: vscode ✓`
- 输入框下方 widget：IDE 名称、workspace、当前文件、选区范围、`pending/sent` 状态

如果 VS Code 后启动，在 Pi 里执行：

```text
/ide auto
```

## 功能验证

### 实时选区

在 VS Code 中打开文件并选中文本，Pi TUI widget 应实时显示：

```text
IDE: vscode ✓ src/foo.ts#L10,20 pending
```

### 手动快捷键

在 VS Code 中选中文本后按：

- Linux/Windows：`Ctrl+Alt+K`
- macOS：`Cmd+Alt+K`

Pi 输入框应插入：

```text
@src/foo.ts#L10,20
```

### LLM 上下文注入

在 Pi 中输入普通对话提示，提交后进行 LLM 调用时，当前 `pending` 的选中文本会临时注入 `context` 事件，不写入 session 历史。

提交完成后 TUI 显示 `sent`。

## `/ide` 命令参考

| 命令 | 行为 |
| --- | --- |
| `/ide` | 打开 TUI 选择器，列出可用 IDE 连接 |
| `/ide status` | 显示当前连接、workspace、最近 selection |
| `/ide list` | 列出 lock 目录中的候选连接 |
| `/ide auto` | 重新按 cwd 自动匹配并连接 |
| `/ide off` | 断开并关闭自动上下文附加 |
| `/ide attach` | 手动把最新 selection range 插入输入框 |

## Lock file 协议

IDE WebSocket server 启动后将连接信息写入 `~/.pi/pi-x-ide/`.

Pi 通过 `ctx.cwd` 与 lock file 中的 `workspaceFolders` 做最长路径匹配，选中最匹配且最新的 IDE 连接。

协议详情见 [docs/specs/ide-protocol.md](docs/specs/ide-protocol.md)。

## VS Code 配置项

| 键 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `piXIde.rangeFormat` | `"comma"` \| `"dash"` | `"comma"` | 手动快捷键生成的文件引用格式 |
