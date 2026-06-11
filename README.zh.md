# Pi × IDE

Pi extension package for IDE selection context integration.

自动将 VS Code 体系 IDE、Zed 和 Neovim 中当前打开或选中的文件与文本范围附加到 Pi TUI，并作为对话上下文提交给 LLM。

## 环境依赖

- Node.js ≥ 26
- pnpm ≥ 11（`packageManager` 声明为 `pnpm@11.5.2`）
- VS Code ≥ 1.90（仅 VS Code 扩展需要）
- Neovim ≥ 0.9（仅 Neovim 插件需要）
- Pi CLI（`@earendil-works/pi-coding-agent ≥ 0.79`）

## 安装与构建

```bash
pnpm install
pnpm build
```

常用命令：

| 命令                  | 说明                                                                                            |
| --------------------- | ----------------------------------------------------------------------------------------------- |
| `pnpm build`          | 编译 Pi 侧 TypeScript → `dist/` + Neovim sidecar → `nvim/bin/` + VS Code bundle → `vscode/out/` |
| `pnpm typecheck`      | 类型检查（不产出文件）                                                                          |
| `pnpm test`           | 编译 + 运行单元测试                                                                             |
| `pnpm package:vscode` | 打包 VS Code 扩展为 VSIX                                                                        |
| `pnpm vsix`           | `pnpm package:vscode` 的别名                                                                    |

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
code --install-extension './vscode'-0.1.0.vsix
```

这样安装的扩展在所有 VS Code 窗口中运行，不依赖 F5 Extension Host。

### 验证扩展是否运行

```bash
ls -l ~/.pi/pi-x-ide/lock
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

当 Pi 从支持的 VS Code 体系集成终端中启动时，它也会异步尝试自动安装或更新 Marketplace 扩展 `balaenis.pi-x-ide`，不会阻塞 Pi 启动。如需只关闭这个安装尝试，设置：

```bash
PI_X_IDE_AUTO_INSTALL=0
```

Pi 侧环境变量也可以写入 `~/.pi/config.json`：

```json
{
  "env": {
    "PI_X_IDE_AUTO_INSTALL": "0"
  }
}
```

真实环境变量优先级高于 `~/.pi/config.json` 中的值。编辑器 schema 指导见 [schemas/config.json](schemas/config.json)。

如果 VS Code 后启动，在 Pi 里执行：

```text
/ide auto
```

如果自动安装成功但没有出现连接，请 reload IDE 窗口后再次运行 `/ide auto`。你也可以运行 `/ide install`，手动选择支持的 `code`、`cursor` 或 `windsurf` CLI。

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

| 命令           | 行为                                              |
| -------------- | ------------------------------------------------- |
| `/ide`         | 打开 TUI 选择器，列出可用 IDE 连接                |
| `/ide status`  | 显示当前连接、workspace、最近 selection           |
| `/ide list`    | 列出 lock 目录中的候选连接                        |
| `/ide auto`    | 重新按 cwd 自动匹配，匹配成功时连接               |
| `/ide off`     | 断开并关闭自动上下文附加                          |
| `/ide attach`  | 手动把最新 selection range 插入输入框             |
| `/ide install` | 通过支持的 IDE CLI 安装或更新 `balaenis.pi-x-ide` |

## Lock file 协议

IDE WebSocket server 启动后默认将连接信息写入 `~/.pi/pi-x-ide/lock/`。可通过真实环境变量 `PI_X_IDE_LOCK_DIR` 覆盖，也可在 `~/.pi/config.json` 的 `env` 中配置。

Pi 通过 `ctx.cwd` 与 lock file 中的 `workspaceFolders` 做最长路径匹配，选中最匹配且最新的 IDE 连接。只有当前 `cwd` 位于某个 IDE `workspaceFolders` 内或与其相等时，Pi 才会自动连接；如果 `cwd` 只是父级目录（例如 `~/`），请运行 `/ide` 手动选择连接。

协议详情见 [docs/specs/ide-protocol.md](docs/specs/ide-protocol.md)。

## 发布

本项目使用 [Release Please](https://github.com/googleapis/release-please) 和 [Conventional Commits](https://www.conventionalcommits.org/) 来自动化版本管理和发布流程。

详见 [RELEASE.md](RELEASE.md)。

## VS Code 配置项

| 键                   | 类型                  | 默认值    | 说明                         |
| -------------------- | --------------------- | --------- | ---------------------------- |
| `piXIde.rangeFormat` | `"comma"` \| `"dash"` | `"comma"` | 手动快捷键生成的文件引用格式 |

## Zed 编辑器支持

当 Pi 在 Zed 终端中运行时（`ZED_TERM=true` 或 `TERM_PROGRAM=zed`），Pi 会自动检测并连接 Zed，无需安装任何 Zed 扩展。

### 工作原理

Pi 直接读取 Zed 的本地 SQLite 状态数据库，获取当前活跃编辑器文件、选中文本范围和缓冲区内容。数据库每秒轮询一次，变化会实时反映在 Pi TUI widget 中。

### 运行要求

- Zed 在同一台机器上运行
- Pi 从 Zed 集成终端启动
- Node.js ≥ 26（需要 `node:sqlite`）

### 配置

| 环境变量          | 默认值       | 说明                       |
| ----------------- | ------------ | -------------------------- |
| `PI_X_IDE_ZED_DB` | （自动检测） | 覆盖 Zed SQLite 数据库路径 |

这个 Pi 侧变量也可以配置在 `~/.pi/config.json` 的 `env` 中。

默认数据库路径：

- **Linux：** `~/.local/share/zed/db/0-stable/db.sqlite`
- **macOS：** `~/Library/Application Support/Zed/db/0-stable/db.sqlite`
- **Windows：** `%LOCALAPPDATA%\\Zed\\db\\0-stable\\db.sqlite`
- **WSL + Windows 版 Zed：** `/mnt/c/Users/<user>/AppData/Local/Zed/db/0-stable/db.sqlite`

当 Pi 运行在 WSL 中，而 Zed 是 Windows 应用时，pi-x-ide 会将 `C:\\Users\\<user>\\project` 这类 Windows 路径规范化为 `/mnt/c/Users/<user>/project`，并将匹配当前发行版的 WSL UNC 路径（例如 `\\\\wsl.localhost\\Ubuntu\\home\\<user>\\project`）规范化为 `/home/<user>/project`。

## Neovim 编辑器支持

Neovim 支持由一个 Lua 插件和一个内置的 Node.js sidecar 组成。插件会启动 sidecar，sidecar 会将 `nvim-<pid>-<port>.lock` 写入 `~/.pi/pi-x-ide/`，Pi 通过与 VS Code 相同的 `/ide` 流程连接。

只要当前目录匹配 Neovim workspace，Pi 可以从任意终端启动，不要求在 Neovim 内部运行。

### lazy.nvim 示例

```lua
{
  "balaenis/pi-x-ide",
  init = function()
    vim.opt.rtp:prepend(vim.fn.stdpath("data") .. "/lazy/pi-x-ide/nvim")
  end,
  config = function()
    require("pi_x_ide").setup({
      keymap = "<C-A-k>",
    })
  end,
}
```

> **注意：** `init` 块手动将 `nvim/` 子目录加入 runtime path。
> 部分版本 lazy.nvim 的 `rtp` 选项存在 Lua 模块解析兼容性问题，此方式可绕过。

### 原生 package 示例

将本仓库 clone 到 Neovim 的 `pack/*/start` 目录，然后加入 `nvim` runtime path 并调用 setup：

```vim
set runtimepath+=/path/to/pi-x-ide/nvim
lua require("pi_x_ide").setup({ keymap = "<leader>pa" })
```

### Neovim 命令

| 命令            | 行为                                                 |
| --------------- | ---------------------------------------------------- |
| `:PiXIdeStart`  | 启动 Neovim sidecar 并写入 lock file                 |
| `:PiXIdeStop`   | 停止 sidecar 并移除 lock file                        |
| `:PiXIdeStatus` | 显示 sidecar 是否正在运行                            |
| `:PiXIdeAttach` | 将当前文件或选区作为 `@relative/path#Lx,y` 附加到 Pi |

### Neovim 配置

```lua
require("pi_x_ide").setup({
  enabled = true,
  keymap = "<C-A-k>",
  range_format = "comma", -- 或 "dash"
  debounce_ms = 150,
  -- sidecar_cmd = { "node", "/absolute/path/to/pi-x-ide-nvim-sidecar.cjs" },
  -- workspace_folders = { "/path/to/project" },
})
```

如果 sidecar 无法启动，请运行 `:PiXIdeStatus`，确认 Neovim 的 `PATH` 中可以找到 Node.js，或将 `sidecar_cmd` 设置为绝对 Node 命令。

### 功能对比

| 功能                              | VS Code     | Zed                         | Neovim                   |
| --------------------------------- | ----------- | --------------------------- | ------------------------ |
| 实时文件追踪                      | ✅ 实时推送 | ✅ 1 秒轮询                 | ✅ 通过 sidecar 实时推送 |
| 实时选区追踪                      | ✅ 实时推送 | ✅ 1 秒轮询                 | ✅ 通过 sidecar 实时推送 |
| `Ctrl+Alt+K` / `Cmd+Alt+K` 快捷键 | ✅          | 手动输入 `@<relative-path>` | 用户自定义 keymap        |
| LLM 上下文注入                    | ✅          | ✅                          | ✅                       |
| `/ide auto`                       | ✅          | ✅                          | ✅                       |
