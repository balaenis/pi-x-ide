# 安装 Neovim 插件

Neovim 支持由一个 Lua 插件加一个 **sidecar** 进程组成。插件观察编辑器和选区；sidecar 持有 Pi 连接的 WebSocket 服务器。sidecar 二进制首次启动时自动下载，并提供 Node.js 回退。

## 前置条件

- 已安装 [`pi`](https://github.com/earendil-works/pi-coding-agent) CLI。
- 已安装 Pi 包：`pi install npm:pi-x-ide`。
- Neovim ≥ 0.9。

## 用 lazy.nvim 安装

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

> **注意：** `init` 块将插件子目录加入 runtime path，以规避部分版本 lazy.nvim 的 Lua 模块解析兼容性问题。可选的 `build` 钩子会预下载 sidecar 二进制；可以省略 - 插件会在首次启动时按需下载。

## 作为原生 package 安装

```vim
set runtimepath+=/path/to/pi-x-ide/ide-plugins/nvim
lua require("pi_x_ide").setup({ keymap = "<leader>pa" })
```

## 验证连接

1. 在 Neovim 中打开项目。
2. 在该项目中打开终端并启动 Pi：

   ```bash
   pi
   ```

3. 打开文件并选中文本（visual 模式）。Pi widget 应显示：

   ```
   ⧉ ⇡ foo.ts#L10-L20
   ```

如果 widget 没出现，见 [排查 sidecar](#排查-sidecar) 和 [排查连接问题](troubleshoot-connection.md)。

## 附加选区

选中文本后，按配置的 `keymap`（默认 `<C-A-k>`），或运行：

```vim
:PiXIdeAttach
```

Pi 把 `@relative/path#Lx-Ly` 插入输入框。提交消息即可把选中文本作为 LLM 上下文发送。

## 配置

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

## 命令

| 命令            | 行为                                                    |
| --------------- | ------------------------------------------------------- |
| `:PiXIdeStart`  | 启动 sidecar 并写入 lock file。                         |
| `:PiXIdeStop`   | 停止 sidecar 并移除 lock file。                         |
| `:PiXIdeStatus` | 显示 sidecar 是否正在运行。                             |
| `:PiXIdeAttach` | 将当前文件或选区作为 `@relative/path#Lx-Ly` 附加到 Pi。 |

## sidecar 的解析顺序

插件按以下顺序解析 sidecar：

1. `ide-plugins/nvim/bin/` 中的平台二进制。
2. 从 GitHub Releases 下载并缓存、经 SHA256 校验的二进制。
3. 回退到 Node.js 脚本（`pi-x-ide-nvim-sidecar.cjs`）。

sidecar 为何存在见 [架构](../explanation/architecture.md#neovim-sidecar)。

## 排查 sidecar

如果 widget 始终不出现，很可能是 sidecar 启动失败。

1. 运行 `:PiXIdeStatus` 查看 sidecar 是否在运行。
2. 检查 lock file 是否已写入：

   ```bash
   ls -l ~/.pi/pi-x-ide/lock
   ```

   应看到类似 `nvim-<pid>-<port>.lock` 的文件。如果没有，说明 sidecar 未启动。

3. 如果二进制下载失败，显式把 `sidecar_cmd` 指向 Node 回退：

   ```lua
   require("pi_x_ide").setup({
     sidecar_cmd = { "node", "/path/to/pi-x-ide/ide-plugins/nvim/bin/pi-x-ide-nvim-sidecar.cjs" },
   })
   ```

4. 依赖回退时，确保 `node` 在 `PATH` 中。
