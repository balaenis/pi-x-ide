# Pi × IDE

> 用于 IDE 选择上下文集成的 Pi 扩展包。

自动将 VS Code、Zed 和 Neovim 中当前打开或选中的文件与文本范围附加到 Pi TUI，并作为对话上下文提交给 LLM。

---

## 安装与使用

### 安装 Pi 扩展包

```bash
pi install npm:pi-x-ide
```

将 `pi-x-ide` 安装为全局 Pi 扩展，Pi 启动时自动加载，无需额外参数。

### 安装 IDE 扩展

#### VS Code / Cursor / Windsurf

**方式一：从 Marketplace 安装（推荐）**

在 IDE 的扩展商店中搜索并安装 [balaenis.pi-x-ide](https://marketplace.visualstudio.com/items?itemName=balaenis.pi-x-ide)。

**方式二：通过 Pi CLI 安装**

在 Pi TUI 中运行 `/ide install`，会自动检测 `code`、`cursor` 或 `windsurf` 并安装扩展。

**方式三：Pi 启动时自动安装**

当 Pi 从支持的 VS Code 集成终端中启动时，会尝试自动安装或更新扩展。如需关闭：

```bash
PI_X_IDE_AUTO_INSTALL=0
```

更多配置项见 [配置参考](#pi-侧环境变量)。

#### Zed

无需安装任何扩展。Pi 在 Zed 终端中运行时（`ZED_TERM=true` 或 `TERM_PROGRAM=zed`）会自动检测并连接。Pi 通过读取 Zed 本地状态数据库获取活跃编辑器和选区信息。

#### Neovim

Neovim 支持由一个 Lua 插件和一个 sidecar 进程组成。首次启动时插件会自动从
GitHub Releases 下载适合当前平台的独立二进制文件（Linux/macOS/Windows，
x64 或 arm64），并在写入缓存前用 release asset 的 SHA-256 digest 做校验。下载
或校验失败、或无匹配二进制时，插件降级到内置的 Node.js sidecar — 此时需要
PATH 中有 Node.js。

二进制文件缓存在 `stdpath("cache")/pi-x-ide/` 目录，后续启动直接复用。插件
更新后会触发一次重新下载。

**lazy.nvim：**

```lua
{
  "balaenis/pi-x-ide",
  init = function(plugin)
    vim.opt.rtp:prepend(plugin.dir .. "/nvim")
  end,
  main = "pi_x_ide",
  opts = {
    keymap = "<leader>aa",
  },
}
```

> **注意：** `init` 块手动将 `nvim/` 子目录加入 runtime path，以规避部分版本 lazy.nvim 的 Lua 模块解析兼容性问题。插件选项通过 lazy.nvim 推荐的 `opts` 字段传入。

**原生 package：**

```vim
set runtimepath+=/path/to/pi-x-ide/nvim
lua require("pi_x_ide").setup({ keymap = "<leader>pa" })
```

完整配置选项、命令和故障排查见 [配置参考](#neovim-2)。

### 连接 Pi 并验证

在 IDE workspace **同一项目目录** 启动 Pi：

```bash
pi
```

Pi 自动加载 `pi-x-ide` 并连接 IDE。TUI 底部应显示 `IDE: vscode ✓`，输入框下方 widget 显示 IDE 名称、workspace、当前文件和选区范围。

**验证是否正常：**

在 IDE 中打开文件并选中文本，widget 应实时更新：

```text
IDE: vscode ✓ src/foo.ts#L10-L20 pending
```

可以从任一侧附加选区：在 VS Code 系列 IDE 中按 `Ctrl+Alt+K`（Linux/Windows）或 `Cmd+Alt+K`（macOS），或聚焦 Pi TUI 后按 `Ctrl+Alt+K` / 运行 `/ide attach`。Pi 输入框应插入 `@src/foo.ts#L10-L20`。

在 Pi 中输入对话提示并提交，选中文本会作为 LLM 上下文注入（不写入 session 历史）。提交后 widget 显示 `sent`。

对于 VS Code 系列 IDE 中的诊断信息，先连接 Pi，再把光标放在 error 或 warning 上并打开 Quick Fix。只有至少一个 Pi 客户端已连接时，才会显示 **Pi: Fix it** 和 **Pi: Send diagnostic**。**Pi: Fix it** 会把诊断消息、源码范围、附近上下文行和 related information 发送给一个已连接的 Pi 客户端，并用可自定义的 prompt 模板自动开始诊断分析（参见 [`fix_prompt`](#pi-侧配置)）。**Pi: Send diagnostic** 会把相同上下文发送给一个已连接的 Pi 客户端并粘贴到 Pi 输入框，不会自动开始一轮对话。

**如果连接未出现：**

- 在 Pi 中运行 `/ide auto` 重新匹配
- 如果 IDE 在 Pi 之后启动，reload IDE 窗口后再次运行 `/ide auto`
- 运行 `/ide` 手动从列表中选择连接

### `/ide` 命令参考

| 命令           | 行为                                              |
| -------------- | ------------------------------------------------- |
| `/ide`         | 打开 TUI 选择器，列出可用 IDE 连接                |
| `/ide status`  | 显示当前连接、workspace、最近 selection           |
| `/ide list`    | 列出 lock 目录中的候选连接                        |
| `/ide auto`    | 重新按 cwd 自动匹配，匹配成功时连接               |
| `/ide off`     | 断开并关闭自动上下文附加                          |
| `/ide attach`  | 手动把最新 selection range 插入输入框             |
| `/ide install` | 通过支持的 IDE CLI 安装或更新 `balaenis.pi-x-ide` |

Pi 默认也会在 TUI 中注册 `Ctrl+Alt+K`，作为 `/ide attach` 的快捷键。重复按下会把最新选中的范围追加到当前输入框，因此可以在编辑器中多次选择不同文本并逐个附加。macOS 上这是终端快捷键（`Ctrl+Option+K`）；`Cmd` 快捷键通常由终端或系统处理，Pi TUI 无法接收。设置 `PI_X_IDE_ATTACH_SHORTCUT` 可改成其他 pi key id；设为 `off`/`none`/`false`/`0` 可禁用。

### 配置参考

#### VS Code

| 键                   | 类型                  | 默认值    | 说明                                                                                    |
| -------------------- | --------------------- | --------- | --------------------------------------------------------------------------------------- |
| `piXIde.useTmux`     | `boolean`             | `false`   | 通过终端图标用 `tmux` 打开 Pi。每次点击都会创建一个新 session，终端 detach 后自动销毁。 |

#### Zed

| 环境变量          | 默认值       | 说明                       |
| ----------------- | ------------ | -------------------------- |
| `PI_X_IDE_ZED_DB` | （自动检测） | 覆盖 Zed SQLite 数据库路径 |

默认数据库路径：

- **Linux：** `~/.local/share/zed/db/0-stable/db.sqlite`
- **macOS：** `~/Library/Application Support/Zed/db/0-stable/db.sqlite`
- **Windows：** `%LOCALAPPDATA%\Zed\db\0-stable\db.sqlite`
- **WSL + Windows 版 Zed：** `/mnt/c/Users/<user>/AppData/Local/Zed/db/0-stable/db.sqlite`

当 Pi 运行在 WSL 中而 Zed 是 Windows 应用时，pi-x-ide 会将 Windows 路径（`C:\Users\<user>\project`）规范化为 `/mnt/c/Users/<user>/project`，并将 WSL UNC 路径规范化为 `/home/<user>/project`。

#### Neovim

```lua
require("pi_x_ide").setup({
  enabled = true,
  keymap = "<C-A-k>",
  debounce_ms = 150,
  -- sidecar_cmd = { "node", "/absolute/path/to/pi-x-ide-nvim-sidecar.cjs" },
  -- （默认使用平台二进制文件；找不到时降级到 node + cjs）
  -- workspace_folders = { "/path/to/project" },
})
```

如果 sidecar 无法启动，请运行 `:PiXIdeStatus`，或设置 `sidecar_cmd` 为自定义
命令。插件优先使用平台二进制文件，找不到匹配项时降级到 Node.js。

**命令：**

| 命令            | 行为                                                 |
| --------------- | ---------------------------------------------------- |
| `:PiXIdeStart`  | 启动 Neovim sidecar 并写入 lock file                 |
| `:PiXIdeStop`   | 停止 sidecar 并移除 lock file                        |
| `:PiXIdeStatus` | 显示 sidecar 是否正在运行                            |
| `:PiXIdeAttach` | 将当前文件或选区作为 `@relative/path#Lx-Ly` 附加到 Pi |

#### Pi 侧环境变量

Pi 侧变量可设为真实环境变量或写入 `~/.pi/pi-x-ide/config.json` 的 `env` 中。真实环境变量优先级更高。

| 变量                            | 默认值       | 说明                                                                      |
| ------------------------------- | ------------ | ------------------------------------------------------------------------- |
| `PI_X_IDE_AUTO_INSTALL`         | `1`          | Pi 启动时自动安装 VS Code 扩展                                            |
| `PI_X_IDE_ATTACH_SHORTCUT`      | `ctrl+alt+k` | Pi TUI 的 `/ide attach` 快捷键；设为 `off`、`none`、`false` 或 `0` 可禁用 |
| `PI_X_IDE_ZED_DB`               | （自动检测） | 覆盖 Zed SQLite 数据库路径                                                |
| `PI_X_IDE_ZED_POLL_INTERVAL_MS` | `1000`       | Zed SQLite 轮询间隔，会被限制在 100-2000 ms 范围                          |

#### 顶层配置选项

| 选项         | 默认值                                                                                          | 说明                                                                                                                                            |
| ------------ | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `fix_prompt` | `Analyze the errors and warnings at the following location, and try to fix them:\n{DIAGNOSTIC}` | 请求修复 IDE 诊断信息时的自定义 prompt 前缀。使用 `{DIAGNOSTIC}` 作为诊断上下文的占位符。如果未包含占位符，诊断上下文会拼接在您的 prompt 之后。 |

编辑器 schema 指导见 [schemas/config.json](schemas/config.json)。[config.example.json](config.example.json) 提供了起始模板。

### 功能对比

| 功能                                             | VS Code              | Zed         | Neovim                   |
| ------------------------------------------------ | -------------------- | ----------- | ------------------------ |
| 实时文件追踪                                     | ✅ 实时推送          | ✅ 1 秒轮询 | ✅ 通过 sidecar 实时推送 |
| 实时选区追踪                                     | ✅ 实时推送          | ✅ 1 秒轮询 | ✅ 通过 sidecar 实时推送 |
| IDE 上下文 attach 快捷键                         | ✅ 默认 `Ctrl+Alt+K` | ❌          | ✅ 自定义快捷键 keymap   |
| Pi TUI 上下文 attach 快捷键（默认 `Ctrl+Alt+K`） | ✅                   | ✅          | ✅                       |
| LLM 上下文注入                                   | ✅                   | ✅          | ✅                       |
| `/ide auto`                                      | ✅                   | ✅          | ✅                       |

### Lock File 协议

IDE WebSocket server 启动后默认将连接信息写入 `~/.pi/pi-x-ide/lock/`。

Pi 通过 `ctx.cwd` 与 lock file 中的 `workspaceFolders` 做最长路径匹配，选中最匹配且最新的 IDE 连接。只有当前 `cwd` 位于某个 IDE `workspaceFolders` 内或与其相等时，Pi 才会自动连接；如果 `cwd` 只是父级目录（例如 `~/`），请运行 `/ide` 手动选择连接。

协议详情见 [docs/specs/ide-protocol.md](docs/specs/ide-protocol.md)。

---

## 开发

### 环境依赖

- Node.js ≥ 26
- bun ≥ 1.3（`packageManager` 声明为 `bun@1.3.14`）
- VS Code ≥ 1.120.0（仅 VS Code 扩展需要）
- Neovim ≥ 0.9（仅 Neovim 插件需要）

### 安装与构建

Clone 仓库后构建：

```bash
git clone https://github.com/balaenis/pi-x-ide.git
cd pi-x-ide
bun install
bun run build
```

加载本地构建（无需全局安装）：

```bash
pi -e ./src/pi/index.ts
```

所有 `bun run` 命令都有等效的 `mise run` 任务（见 `mise.toml`）：

| 命令                          | 说明                                                                                            |
| ----------------------------- | ----------------------------------------------------------------------------------------------- |
| `bun run build`               | 编译 Pi 侧 TypeScript → `dist/` + Neovim sidecar → `nvim/bin/` + VS Code bundle → `vscode/out/` |
| `bun run typecheck`           | 类型检查（不产出文件）                                                                          |
| `bun run test`                | 编译 + 运行单元测试                                                                             |
| `bun run package:vsix`        | 打包 VS Code 扩展为 VSIX                                                                        |
| `bun run check:config-schema` | 验证 `schemas/config.json` 与配置注册表是否同步                                                 |

### 本地测试 VS Code 扩展

#### 方式一：F5 启动 Extension Development Host（推荐）

1. 用 VS Code 打开 **项目根目录**。
2. 进入 **Run and Debug** 面板（`Ctrl+Shift+D`）。
3. 选择 **Run Pi x IDE VS Code Extension**。
4. 按 **F5**：
   - preLaunchTask 会自动执行 `bun run build`。
   - 打开一个标题包含 `[Extension Development Host]` 的新 VS Code 窗口。

#### 方式二：打包 VSIX 后安装

```bash
bun run package:vsix
cd vscode && code --install-extension dist/pi-x-ide-$(node -p "require('./package.json').version").vsix
```

这样安装的扩展在所有 VS Code 窗口中运行，不依赖 F5 Extension Host。

#### 验证扩展是否运行

```bash
ls -l ~/.pi/pi-x-ide/lock
```

应看到类似 `vscode-12345-48123.lock` 的文件。如果没有，在 VS Code 中执行 **Developer: Reload Window**。

### 发布

本项目使用 [Release Please](https://github.com/googleapis/release-please) 和 [Conventional Commits](https://www.conventionalcommits.org/) 来自动化版本管理和发布流程。

详见 [RELEASE.md](RELEASE.md)。

## 致谢

- [opencode](https://github.com/anomalyco/opencode)
