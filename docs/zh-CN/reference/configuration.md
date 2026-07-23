# 配置参考

Pi × IDE 通过三层配置：各 IDE 设置、Pi 侧环境变量，以及 config JSON 中的顶层选项。

配置文件：

- **全局：** `~/.pi/pi-x-ide/config.json`
- **项目：** `<cwd>/.pi/pi-x-ide/config.json`（对支持的键覆盖全局）

Pi 侧变量可设为真实环境变量 **或** 写入 config 的 `env`。真实环境变量优先级更高。交互设置（`Display`、`AutoInstall` 等）见 [`/ide settings`](commands.md)。

```json
{
  "$schema": "https://raw.githubusercontent.com/balaenis/pi-x-ide/refs/heads/main/schemas/config.json",
  "fixPrompt": "Analyze the errors and warnings at the following location, and try to fix them:\n{DIAGNOSTIC}",
  "status_display": "widget",
  "env": {
    "PI_X_IDE_AUTO_INSTALL": "1",
    "PI_X_IDE_ATTACH_SHORTCUT": "ctrl+alt+k"
  }
}
```

起始模板见 [`config.example.json`](../../../config.example.json)，编辑器 schema 见 [`schemas/config.json`](../../../schemas/config.json)。

## VS Code 设置

| 键               | 类型      | 默认值  | 说明                                                                                    |
| ---------------- | --------- | ------- | --------------------------------------------------------------------------------------- |
| `piXIde.useTmux` | `boolean` | `false` | 通过终端图标用 `tmux` 打开 Pi。每次点击都会创建一个新 session，终端 detach 后自动销毁。 |

## Zed

| 环境变量                        | 默认值       | 说明                                                |
| ------------------------------- | ------------ | --------------------------------------------------- |
| `PI_X_IDE_ZED_DB`               | （自动检测） | 覆盖 Zed SQLite 数据库路径。                        |
| `PI_X_IDE_ZED_POLL_INTERVAL_MS` | `1000`       | Zed SQLite 轮询间隔（毫秒），限制在 100–2000 范围。 |

默认数据库路径：

- **Linux：** `~/.local/share/zed/db/0-stable/db.sqlite`
- **macOS：** `~/Library/Application Support/Zed/db/0-stable/db.sqlite`
- **Windows：** `%LOCALAPPDATA%\Zed\db\0-stable\db.sqlite`
- **WSL + Windows 版 Zed：** `/mnt/c/Users/<user>/AppData/Local/Zed/db/0-stable/db.sqlite`

## Neovim

```lua
require("pi_x_ide").setup({
  enabled = true,
  keymap = "<C-A-k>",
  debounce_ms = 150,
  -- sidecar_cmd = { "node", "/absolute/path/to/pi-x-ide-nvim-sidecar.cjs" },
  -- workspace_folders = { "/path/to/project" },
})
```

| 选项                | 默认值    | 说明                                |
| ------------------- | --------- | ----------------------------------- |
| `enabled`           | `true`    | 启用或禁用插件。                    |
| `keymap`            | `<C-A-k>` | 附加当前选区到 Pi 的快捷键。        |
| `debounce_ms`       | `150`     | 选区通知去抖间隔。                  |
| `sidecar_cmd`       | （自动）  | 覆盖 sidecar 命令。                 |
| `workspace_folders` | （自动）  | 覆盖向 Pi 广播的 workspace 文件夹。 |

如果 sidecar 无法启动，请运行 `:PiXIdeStatus`，或设置 `sidecar_cmd` 为自定义命令。见 [安装 Neovim 插件](../how-to/install-neovim.md#排查-sidecar)。

| 命令            | 行为                                                    |
| --------------- | ------------------------------------------------------- |
| `:PiXIdeStart`  | 启动 Neovim sidecar 并写入 lock file。                  |
| `:PiXIdeStop`   | 停止 sidecar 并移除 lock file。                         |
| `:PiXIdeStatus` | 显示 sidecar 是否正在运行。                             |
| `:PiXIdeAttach` | 将当前文件或选区作为 `@relative/path#Lx-Ly` 附加到 Pi。 |

## Pi 侧环境变量

| 变量                            | 默认值       | 说明                                                                                                            |
| ------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------- |
| `PI_X_IDE_AUTO_INSTALL`         | `1`          | Pi 启动时自动安装 VS Code 扩展。设为 `0`/`false`/`off` 可禁用。也可在 `/ide settings` 中以 `AutoInstall` 配置。 |
| `PI_X_IDE_ATTACH_SHORTCUT`      | `ctrl+alt+k` | Pi TUI 的 `/ide attach` 快捷键。设为 `off`、`none`、`false` 或 `0` 可禁用。                                     |
| `PI_X_IDE_HOST_OVERRIDE`        | （未设置）   | 覆盖 Pi 连接 IDE WebSocket 时使用的 host。适用于 WSL2 网络场景。                                                |
| `PI_X_IDE_ZED_DB`               | （自动检测） | 覆盖 Zed SQLite 数据库路径。                                                                                    |
| `PI_X_IDE_ZED_POLL_INTERVAL_MS` | `1000`       | Zed SQLite 轮询间隔（毫秒），限制在 100–2000 范围。                                                             |

## 顶层选项

<a id="顶层选项"></a>

| 选项             | 默认值                                                                                          | 说明                                                                                                                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fixPrompt`      | `Analyze the errors and warnings at the following location, and try to fix them:\n{DIAGNOSTIC}` | 请求修复 IDE 诊断信息时的自定义 prompt 前缀。使用 `{DIAGNOSTIC}` 作为诊断上下文的占位符。如果未包含占位符，诊断上下文会拼接在你的 prompt 之后。                                         |
| `status_display` | `widget`                                                                                        | 在 Pi TUI 中显示 IDE 连接状态的位置。默认 `widget`（编辑器上方）；`statusline` 使用页脚状态行。同一时间只启用一种显示方式。项目配置覆盖全局。可在 `/ide settings` 中以 `Display` 设置。 |

`fixPrompt` 控制 VS Code **Pi: Fix it** Quick Fix 使用的 prompt。见 [安装 VS Code 扩展](../how-to/install-vscode.md#诊断-quick-fix)。
