# Install the Neovim plugin

Neovim support uses a Lua plugin plus a **sidecar** process. The plugin observes
your editor and selection; the sidecar owns the WebSocket server that Pi connects
to. The sidecar binary is downloaded automatically on first start, with a Node.js
fallback.

## Prerequisites

- The [`pi`](https://github.com/earendil-works/pi-coding-agent) CLI installed.
- The `pi-x-ide` Pi package installed: `pi install npm:pi-x-ide`.
- Neovim ≥ 0.9.

## Install with lazy.nvim

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

> **Note:** The `init` block adds the plugin subdirectory to the runtime path to
> work around a Lua module resolution issue with some lazy.nvim versions. The
> optional `build` hook pre-downloads the sidecar binary; it is safe to omit - the
> plugin downloads it lazily on first start.

## Install as a native package

```vim
set runtimepath+=/path/to/pi-x-ide/ide-plugins/nvim
lua require("pi_x_ide").setup({ keymap = "<leader>pa" })
```

## Verify the connection

1. Open a project in Neovim.
2. Open a terminal in that project and start Pi:

   ```bash
   pi
   ```

3. Open a file and select some text (visual mode). The Pi widget should show:

   ```
   ⧉ ⇡ foo.ts#L10-L20
   ```

If the widget does not appear, see [Troubleshoot the sidecar](#troubleshoot-the-sidecar)
and [Troubleshoot a missing connection](troubleshoot-connection.md).

## Attach a selection

With text selected, either press your configured `keymap` (default `<C-A-k>`) or
run:

```vim
:PiXIdeAttach
```

Pi inserts `@relative/path#Lx-Ly` into the input box. Submit your message to send
the selected text as LLM context.

## Configuration

```lua
require("pi_x_ide").setup({
  enabled = true,
  keymap = "<C-A-k>",
  debounce_ms = 150,
  -- sidecar_cmd = { "node", "/absolute/path/to/pi-x-ide-nvim-sidecar.cjs" },
  -- workspace_folders = { "/path/to/project" },
})
```

| Option              | Default   | Description                                      |
| ------------------- | --------- | ------------------------------------------------ |
| `enabled`           | `true`    | Enable or disable the plugin.                    |
| `keymap`            | `<C-A-k>` | Keymap to attach the current selection to Pi.    |
| `debounce_ms`       | `150`     | Debounce interval for selection notifications.   |
| `sidecar_cmd`       | (auto)    | Override the sidecar command.                    |
| `workspace_folders` | (auto)    | Override the workspace folders advertised to Pi. |

## Commands

| Command         | Behavior                                                              |
| --------------- | --------------------------------------------------------------------- |
| `:PiXIdeStart`  | Start the sidecar and write the lock file.                            |
| `:PiXIdeStop`   | Stop the sidecar and remove the lock file.                            |
| `:PiXIdeStatus` | Show whether the sidecar is running.                                  |
| `:PiXIdeAttach` | Attach the current file or selection to Pi as `@relative/path#Lx-Ly`. |

## How the sidecar is resolved

The plugin resolves the sidecar in this order:

1. A platform binary bundled in `ide-plugins/nvim/bin/`.
2. A cached binary downloaded from GitHub Releases, verified by SHA256.
3. A fallback Node.js script (`pi-x-ide-nvim-sidecar.cjs`).

See [Architecture](../explanation/architecture.md#the-neovim-sidecar) for why a
sidecar exists at all.

## Troubleshoot the sidecar

If the widget never appears, the sidecar likely failed to start.

1. Run `:PiXIdeStatus` to see whether the sidecar is running.
2. Check that the lock file was written:

   ```bash
   ls -l ~/.pi/pi-x-ide/lock
   ```

   You should see a file like `nvim-<pid>-<port>.lock`. If not, the sidecar did
   not start.

3. If the binary download failed, point `sidecar_cmd` at the Node fallback
   explicitly:

   ```lua
   require("pi_x_ide").setup({
     sidecar_cmd = { "node", "/path/to/pi-x-ide/ide-plugins/nvim/bin/pi-x-ide-nvim-sidecar.cjs" },
   })
   ```

4. Make sure `node` is on your `PATH` if you rely on the fallback.
