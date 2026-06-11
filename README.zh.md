# Pi × IDE

> 用于 IDE 选择上下文集成的 Pi 扩展包。

自动将 VS Code、Zed 和 Neovim 中当前打开或选中的文件与文本范围附加到 Pi TUI，并作为对话上下文提交给 LLM。

---

## 安装与使用

### 1. 安装 Pi CLI

[Pi Quickstart](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/quickstart.md)

### 2. 安装 Pi 扩展包

```bash
pi install npm:pi-x-ide
```

将 `pi-x-ide` 安装为全局 Pi 扩展，Pi 启动时自动加载，无需额外参数。

### 3. 安装 IDE 扩展

#### VS Code / Cursor / Windsurf

**方式一：从 Marketplace 安装（推荐）**

在 IDE 的扩展商店中搜索并安装 `balaenis.pi-x-ide`。

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

需要 Node.js ≥ 26，Zed 在同一台机器上运行。

#### Neovim

Neovim 支持由一个 Lua 插件和一个 sidecar 进程组成。已内置 Linux (x64/arm64)、
macOS (x64/arm64) 和 Windows (x64) 的独立二进制文件。若没有匹配的二进制，
插件会降级到内置的 Node.js sidecar — 此时需要 PATH 中有 Node.js。

**lazy.nvim：**

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

> **注意：** `init` 块手动将 `nvim/` 子目录加入 runtime path，以规避部分版本 lazy.nvim 的 Lua 模块解析兼容性问题。

**原生 package：**

```vim
set runtimepath+=/path/to/pi-x-ide/nvim
lua require("pi_x_ide").setup({ keymap = "<leader>pa" })
```

完整配置选项、命令和故障排查见 [配置参考](#neovim-2)。

### 4. 连接 Pi 并验证

在 IDE workspace **同一项目目录** 启动 Pi：

```bash
pi
```

Pi 自动加载 `pi-x-ide` 并连接 IDE。TUI 底部应显示 `IDE: vscode ✓`，输入框下方 widget 显示 IDE 名称、workspace、当前文件和选区范围。

**验证是否正常：**

在 IDE 中打开文件并选中文本，widget 应实时更新：

```text
IDE: vscode ✓ src/foo.ts#L10,20 pending
```

按 `Ctrl+Alt+K`（Linux/Windows）或 `Cmd+Alt+K`（macOS），Pi 输入框应插入 `@src/foo.ts#L10,20`。

在 Pi 中输入对话提示并提交，选中文本会作为 LLM 上下文注入（不写入 session 历史）。提交后 widget 显示 `sent`。

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

### 配置参考

#### VS Code

| 键                   | 类型                  | 默认值    | 说明                         |
| -------------------- | --------------------- | --------- | ---------------------------- |
| `piXIde.rangeFormat` | `"comma"` \| `"dash"` | `"comma"` | 手动快捷键生成的文件引用格式 |

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
  range_format = "comma", -- 或 "dash"
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
| `:PiXIdeAttach` | 将当前文件或选区作为 `@relative/path#Lx,y` 附加到 Pi |

#### Pi 侧环境变量

Pi 侧变量可设为真实环境变量或写入 `~/.pi/config.json` 的 `env` 中。真实环境变量优先级更高。

| 变量                    | 默认值                | 说明                           |
| ----------------------- | --------------------- | ------------------------------ |
| `PI_X_IDE_AUTO_INSTALL` | `1`                   | Pi 启动时自动安装 VS Code 扩展 |
| `PI_X_IDE_LOCK_DIR`     | `~/.pi/pi-x-ide/lock` | IDE 连接 lock file 存放目录    |
| `PI_X_IDE_ZED_DB`       | （自动检测）          | 覆盖 Zed SQLite 数据库路径     |

编辑器 schema 指导见 [schemas/config.json](schemas/config.json)。

### 功能对比

| 功能                              | VS Code     | Zed                         | Neovim                   |
| --------------------------------- | ----------- | --------------------------- | ------------------------ |
| 实时文件追踪                      | ✅ 实时推送 | ✅ 1 秒轮询                 | ✅ 通过 sidecar 实时推送 |
| 实时选区追踪                      | ✅ 实时推送 | ✅ 1 秒轮询                 | ✅ 通过 sidecar 实时推送 |
| `Ctrl+Alt+K` / `Cmd+Alt+K` 快捷键 | ✅          | 手动输入 `@<relative-path>` | 用户自定义 keymap        |
| LLM 上下文注入                    | ✅          | ✅                          | ✅                       |
| `/ide auto`                       | ✅          | ✅                          | ✅                       |

### Lock File 协议

IDE WebSocket server 启动后默认将连接信息写入 `~/.pi/pi-x-ide/lock/`。可通过 `PI_X_IDE_LOCK_DIR` 覆盖。

Pi 通过 `ctx.cwd` 与 lock file 中的 `workspaceFolders` 做最长路径匹配，选中最匹配且最新的 IDE 连接。只有当前 `cwd` 位于某个 IDE `workspaceFolders` 内或与其相等时，Pi 才会自动连接；如果 `cwd` 只是父级目录（例如 `~/`），请运行 `/ide` 手动选择连接。

协议详情见 [docs/specs/ide-protocol.md](docs/specs/ide-protocol.md)。

---

## 开发

### 环境依赖

- Node.js ≥ 26
- pnpm ≥ 11（`packageManager` 声明为 `pnpm@11.5.2`）
- VS Code ≥ 1.90（仅 VS Code 扩展需要）
- Neovim ≥ 0.9（仅 Neovim 插件需要）

### 安装与构建

Clone 仓库后构建：

```bash
git clone https://github.com/balaenis/pi-x-ide.git
cd pi-x-ide
pnpm install
pnpm build
```

加载本地构建（无需全局安装）：

```bash
pi -e ./src/pi/index.ts
```

常用命令：

| 命令                  | 说明                                                                                            |
| --------------------- | ----------------------------------------------------------------------------------------------- |
| `pnpm build`          | 编译 Pi 侧 TypeScript → `dist/` + Neovim sidecar → `nvim/bin/` + VS Code bundle → `vscode/out/` |
| `pnpm typecheck`      | 类型检查（不产出文件）                                                                          |
| `pnpm test`           | 编译 + 运行单元测试                                                                             |
| `pnpm package:vscode` | 打包 VS Code 扩展为 VSIX                                                                        |
| `pnpm vsix`           | `pnpm package:vscode` 的别名                                                                    |

### 本地测试 VS Code 扩展

#### 方式一：F5 启动 Extension Development Host（推荐）

1. 用 VS Code 打开 **项目根目录**。
2. 进入 **Run and Debug** 面板（`Ctrl+Shift+D`）。
3. 选择 **Run Pi x IDE VS Code Extension**。
4. 按 **F5**：
   - preLaunchTask 会自动执行 `pnpm build`。
   - 打开一个标题包含 `[Extension Development Host]` 的新 VS Code 窗口。

#### 方式二：打包 VSIX 后安装

```bash
pnpm package:vscode
code --install-extension './vscode'-0.1.0.vsix
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
