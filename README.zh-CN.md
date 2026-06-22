# Pi × IDE

> 用于 IDE 选择上下文集成的 Pi 扩展包。

自动将 VS Code、Zed、Neovim 和 JetBrains IDE 中当前打开或选中的文件与文本范围附加到 Pi TUI，并作为对话上下文提交给 LLM。

---

## 安装与使用

### 安装 Pi 扩展包

```bash
pi install npm:pi-x-ide
```

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

Neovim 支持由一个 Lua 插件和一个 sidecar 进程组成。插件首次启动时自动下载
平台二进制文件，不可用时回退到 Node.js。

**lazy.nvim：**

```lua
{
  "balaenis/pi-x-ide",
  build = function(plugin)
    vim.opt.rtp:prepend(plugin.dir .. "/ide-plugins/nvim")
    require("pi_x_ide.download").run({ refresh = true })
  end,
  init = function(plugin)
    vim.opt.rtp:prepend(plugin.dir .. "/ide-plugins/nvim")
  end,
  main = "pi_x_ide",
  opts = {
    keymap = "<leader>aa",
  },
}
```

> **注意：** `init` 块将插件子目录加入 runtime path，以规避部分版本 lazy.nvim 的
> Lua 模块解析兼容性问题。可选的 `build` 钩子会预下载 sidecar 二进制；可以省略
> — 插件会在首次启动时按需下载。

**原生 package：**

```vim
set runtimepath+=/path/to/pi-x-ide/ide-plugins/nvim
lua require("pi_x_ide").setup({ keymap = "<leader>pa" })
```

完整配置选项、命令和故障排查见 [配置参考](#neovim-2)。

#### JetBrains IDE

从 [GitHub 最新 Release](https://github.com/balaenis/pi-x-ide/releases/latest) 下载 JetBrains 插件 ZIP，然后在 JetBrains IDE 中通过 **Settings | Plugins | ⚙ | Install Plugin from Disk...** 安装。

### 连接 Pi 并验证

在 IDE workspace **同一项目目录** 启动 Pi：

```bash
pi
```

Pi 自动加载 `pi-x-ide` 并连接 IDE。TUI 在编辑器上方显示一个 widget，展示当前
IDE 连接和选区状态。

**验证是否正常：**

在 IDE 中打开文件并选中文本，widget 应实时更新：

```text
⧉ ⇡ foo.ts#L10-L20
```

可以从任一侧附加选区：在 VS Code 系列 IDE 中按 `Ctrl+Alt+K`（Linux/Windows）或 `Cmd+Alt+K`（macOS），在 JetBrains 中按 `Ctrl+Alt+K` 或运行 **Pi x IDE: Attach Selection**，在 Neovim 中使用 `:PiXIdeAttach`，或聚焦 Pi TUI 后按 `Ctrl+Alt+K` / 运行 `/ide attach`。Pi 输入框应插入 `@src/foo.ts#L10-L20`。

在 Pi 中输入对话提示并提交，选中文本会作为 LLM 上下文注入。
提交后 widget 变为 `⧉ ✓ foo.ts#L10-L20`。

**诊断 Quick Fix（仅 VS Code）：** 将光标放在 error 或 warning 上，打开 Quick Fix，
选择 **Pi: Fix it** 将诊断信息发送给 Pi 并启动分析对话，或选择 **Pi: Send diagnostic**
将其粘贴到输入框。

**如果连接未出现：**

- 在 Pi 中运行 `/ide auto` 重新匹配
- 如果 IDE 在 Pi 之后启动，reload IDE 窗口后再次运行 `/ide auto`
- 运行 `/ide` 手动从列表中选择连接

### WSL2

当 Pi 运行在 WSL2 中、IDE 运行在原生 Windows 上时，Pi 会自动跨 WSL 边界发现
IDE 连接。大多数情况下无需额外配置。

如果你的 WSL 网络模式、防火墙或终端安全策略阻止自动发现，可设置
`PI_X_IDE_HOST_OVERRIDE`：

```bash
PI_X_IDE_HOST_OVERRIDE=127.0.0.1 pi
PI_X_IDE_HOST_OVERRIDE=<windows-host-ip> pi
```

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

| 键               | 类型      | 默认值  | 说明                                                                                    |
| ---------------- | --------- | ------- | --------------------------------------------------------------------------------------- |
| `piXIde.useTmux` | `boolean` | `false` | 通过终端图标用 `tmux` 打开 Pi。每次点击都会创建一个新 session，终端 detach 后自动销毁。 |

#### Zed

| 环境变量          | 默认值       | 说明                       |
| ----------------- | ------------ | -------------------------- |
| `PI_X_IDE_ZED_DB` | （自动检测） | 覆盖 Zed SQLite 数据库路径 |

默认数据库路径：

- **Linux：** `~/.local/share/zed/db/0-stable/db.sqlite`
- **macOS：** `~/Library/Application Support/Zed/db/0-stable/db.sqlite`
- **Windows：** `%LOCALAPPDATA%\Zed\db\0-stable\db.sqlite`
- **WSL + Windows 版 Zed：** `/mnt/c/Users/<user>/AppData/Local/Zed/db/0-stable/db.sqlite`

#### Neovim

```lua
require("pi_x_ide").setup({
  enabled = true,
  keymap = "<C-A-k>",
  debounce_ms = 150,
  -- sidecar_cmd = { "node", "/absolute/path/to/pi-x-ide-nvim-sidecar.cjs" },
  -- workspace_folders = { "/path/to/project" },
})
```

如果 sidecar 无法启动，请运行 `:PiXIdeStatus`，或设置 `sidecar_cmd` 为自定义命令。

**命令：**

| 命令            | 行为                                                  |
| --------------- | ----------------------------------------------------- |
| `:PiXIdeStart`  | 启动 Neovim sidecar 并写入 lock file                  |
| `:PiXIdeStop`   | 停止 sidecar 并移除 lock file                         |
| `:PiXIdeStatus` | 显示 sidecar 是否正在运行                             |
| `:PiXIdeAttach` | 将当前文件或选区作为 `@relative/path#Lx-Ly` 附加到 Pi |

#### Pi 侧环境变量

Pi 侧变量可设为真实环境变量或写入 `~/.pi/pi-x-ide/config.json` 的 `env` 中。真实环境变量优先级更高。

| 变量                            | 默认值       | 说明                                                                      |
| ------------------------------- | ------------ | ------------------------------------------------------------------------- |
| `PI_X_IDE_AUTO_INSTALL`         | `1`          | Pi 启动时自动安装 VS Code 扩展                                            |
| `PI_X_IDE_ATTACH_SHORTCUT`      | `ctrl+alt+k` | Pi TUI 的 `/ide attach` 快捷键；设为 `off`、`none`、`false` 或 `0` 可禁用 |
| `PI_X_IDE_HOST_OVERRIDE`        | （未设置）   | 覆盖 Pi 连接 IDE WebSocket lock file 时使用的 host；适用于 WSL2 网络场景  |
| `PI_X_IDE_ZED_DB`               | （自动检测） | 覆盖 Zed SQLite 数据库路径                                                |
| `PI_X_IDE_ZED_POLL_INTERVAL_MS` | `1000`       | Zed SQLite 轮询间隔，会被限制在 100-2000 ms 范围                          |

#### 顶层配置选项

| 选项         | 默认值                                                                                          | 说明                                                                                                                                            |
| ------------ | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `fix_prompt` | `Analyze the errors and warnings at the following location, and try to fix them:\n{DIAGNOSTIC}` | 请求修复 IDE 诊断信息时的自定义 prompt 前缀。使用 `{DIAGNOSTIC}` 作为诊断上下文的占位符。如果未包含占位符，诊断上下文会拼接在您的 prompt 之后。 |

编辑器 schema 指导见 [schemas/config.json](schemas/config.json)。[config.example.json](config.example.json) 提供了起始模板。

### 功能对比

| 功能                                             | VS Code              | Zed         | Neovim                   | JetBrains            |
| ------------------------------------------------ | -------------------- | ----------- | ------------------------ | -------------------- |
| 实时文件追踪                                     | ✅ 实时推送          | ✅ 1 秒轮询 | ✅ 通过 sidecar 实时推送 | ✅ 实时推送          |
| 实时选区追踪                                     | ✅ 实时推送          | ✅ 1 秒轮询 | ✅ 通过 sidecar 实时推送 | ✅ 实时推送          |
| IDE 上下文 attach 快捷键                         | ✅ 默认 `Ctrl+Alt+K` | ❌          | ✅ 自定义快捷键 keymap   | ✅ 默认 `Ctrl+Alt+K` |
| Pi TUI 上下文 attach 快捷键（默认 `Ctrl+Alt+K`） | ✅                   | ✅          | ✅                       | ✅                   |
| LLM 上下文注入                                   | ✅                   | ✅          | ✅                       | ✅                   |
| `/ide auto`                                      | ✅                   | ✅          | ✅                       | ✅                   |
| 诊断 Quick Fix                                   | ✅                   | ❌          | ❌                       | ❌                   |
| 自动安装                                         | ✅ 仅 VS Code 系列   | N/A         | ❌                       | ❌                   |

### 发现机制

Pi 通过 `~/.pi/pi-x-ide/lock/` 下的 lock file 发现 IDE 连接。当终端 `cwd`
位于某个 IDE workspace 目录内时自动连接；如果 `cwd` 只是父级目录（如 `~/`），
请运行 `/ide` 手动选择连接。

完整协议见 [docs/specs/ide-protocol.md](docs/specs/ide-protocol.md)。

---

## 开发

### 环境依赖

- Node.js ≥ 26
- bun ≥ 1.3（`packageManager` 声明为 `bun@1.3.14`）
- VS Code ≥ 1.120.0（仅 VS Code 扩展需要）
- Neovim ≥ 0.9（仅 Neovim 插件需要）
- JDK 21（仅 JetBrains 插件需要；Gradle 可自动下载 toolchain）

### 安装与构建

Clone 仓库后构建：

```bash
git clone https://github.com/balaenis/pi-x-ide.git
cd pi-x-ide
mise run setup
mise run build
```

加载本地构建（无需全局安装）：

```bash
pi -e ./src/pi/index.ts
```

所有构建与检查命令都定义为 `mise run` 任务（见 `.mise/tasks/`）：

| 命令                           | 说明                                                                                                                    |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `mise run build`               | 编译 Pi 侧 TypeScript → `dist/` + Neovim sidecar → `ide-plugins/nvim/bin/` + VS Code bundle → `ide-plugins/vscode/out/` |
| `mise run typecheck`           | 类型检查（不产出文件）                                                                                                  |
| `mise run test`                | 编译 + 运行单元测试                                                                                                     |
| `mise run package:vsix`        | 打包 VS Code 扩展为 VSIX                                                                                                |
| `mise run compile:jetbrains`   | 用 Gradle 编译并测试 JetBrains 插件                                                                                     |
| `mise run package:jetbrains`   | 将 JetBrains 插件打包为 `ide-plugins/jetbrains/build/distributions/` 下的 ZIP                                           |
| `mise run verify:jetbrains`    | 对配置的目标 IDE 运行 IntelliJ Plugin Verifier                                                                          |
| `mise run check:config-schema` | 验证 `schemas/config.json` 与配置注册表是否同步                                                                         |

### 本地测试 VS Code 扩展

#### 方式一：F5 启动 Extension Development Host（推荐）

1. 用 VS Code 打开 **项目根目录**。
2. 进入 **Run and Debug** 面板（`Ctrl+Shift+D`）。
3. 选择 **Run Pi x IDE VS Code Extension**。
4. 按 **F5**：
   - preLaunchTask 会自动执行 `mise run build`。
   - 打开一个标题包含 `[Extension Development Host]` 的新 VS Code 窗口。

#### 方式二：打包 VSIX 后安装

```bash
mise run package:vsix
cd ide-plugins/vscode && code --install-extension dist/pi-x-ide-$(node -p "require('./package.json').version").vsix
```

这样安装的扩展在所有 VS Code 窗口中运行，不依赖 F5 Extension Host。

#### 验证扩展是否运行

```bash
ls -l ~/.pi/pi-x-ide/lock
```

应看到类似 `vscode-12345-48123.lock` 的文件。如果没有，在 VS Code 中执行 **Developer: Reload Window**。

### 本地测试 JetBrains 插件

运行 sandbox IDE：

```bash
cd ide-plugins/jetbrains
./gradlew runIde
```

构建可安装的插件 ZIP：

```bash
mise run package:jetbrains
```

ZIP 会输出到 `ide-plugins/jetbrains/build/distributions/`。Smoke test：在 sandbox IDE 中打开本仓库，从同一目录启动 `pi`，打开并选择一个本地文件中的文本，然后按 `Ctrl+Alt+K` 或运行 **Pi x IDE: Attach Selection**。Pi 应收到 `@relative/path#Lx-Ly` mention。

### 发布

本项目使用 [Release Please](https://github.com/googleapis/release-please) 和 [Conventional Commits](https://www.conventionalcommits.org/) 来自动化版本管理和发布流程。

详见 [RELEASE.md](RELEASE.md)。

## 致谢

- [opencode](https://github.com/anomalyco/opencode)
