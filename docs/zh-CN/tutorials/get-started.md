# Pi × IDE 入门指南

本教程带你从全新安装走到第一次把 IDE 选区送进 LLM 对话。大约 5 分钟，以 VS Code 为例 - Cursor 和 Windsurf 流程相同。

> 已经装好了，只想附加选区？直接跳到 [附加选区并对话](#第-5-步附加选区并对话)。
> 用其他编辑器？Zed、Neovim、JetBrains 的安装见 [操作指南](../how-to/)。

## 你将学到

- 如何安装 Pi 扩展包和 VS Code 扩展。
- 如何启动 Pi 让它自动发现你的 IDE。
- 一段选中的文本如何变成 LLM 上下文。

## 开始之前

你需要：

- 已安装 [`pi`](https://github.com/earendil-works/pi-coding-agent) CLI 并加入 `PATH`。
- 已安装 VS Code、Cursor 或 Windsurf。
- 一个至少包含一个源文件的项目文件夹。

## 第 1 步：安装 Pi 扩展包

```bash
pi install npm:pi-x-ide
```

这会把 `pi-x-ide` 包加入 Pi。下次启动 Pi 时会自动加载，无需额外配置。

## 第 2 步：安装 VS Code 扩展

在 IDE 的 **扩展** 面板搜索
[`balaenis.pi-x-ide`](https://marketplace.visualstudio.com/items?itemName=balaenis.pi-x-ide)
并安装。

> 也可以在 Pi TUI 中运行 `/ide install`，它会自动检测 `code`、`cursor` 或 `windsurf` 并安装扩展。Pi 启动时若检测到受支持的 VS Code 集成终端，也会尝试自动安装。

安装后重新加载 IDE 窗口，让扩展生效。

## 第 3 步：在项目中启动 Pi

在 IDE 内打开终端（Terminal -> New Terminal），然后在与 IDE workspace 相同的项目目录启动 Pi：

```bash
pi
```

Pi 加载 `pi-x-ide` 并查找 IDE 连接。当终端工作目录位于某个 IDE workspace 文件夹内时，Pi 会自动连接。Pi 输入框上方会出现一个 widget，显示连接和选区状态。

## 第 4 步：打开文件并选中文本

回到 IDE，打开一个源文件，选中几行文本。Pi widget 应实时更新：

```
⧉ ⇡ foo.ts#L10-L20
```

`⇡` 标记表示选区处于 **pending** 状态 - Pi 已注意到它，但尚未附加到消息。

如果 widget 没出现，见 [排查连接问题](../how-to/troubleshoot-connection.md)。

## 第 5 步：附加选区并对话

在 IDE 中选中文本后，聚焦 Pi TUI 并按 `Ctrl+Alt+K`（macOS：`Ctrl+Option+K`）。Pi 会在输入框插入一个 mention：

```
@src/foo.ts#L10-L20
```

输入问题并提交，选中文本会作为该轮的 LLM 上下文注入。提交后 widget 标记变为 `✓`：

```
⧉ ✓ foo.ts#L10-L20
```

你可以反复按 `Ctrl+Alt+K` 把多个范围追加到同一条消息，也可以在两轮之间重新选中文本，每次附加新的上下文。

## 刚才发生了什么

当你选中文本时，VS Code 扩展会通过本地 WebSocket 向 Pi 广播一条 `selection_changed` 通知。Pi 缓存最新选区并标记为 pending。按下附加快捷键时，Pi 把 `@file#Lx-Ly` mention 插入输入框。提交消息时，Pi 把选中文本包装后注入用户消息，再交给 LLM。

完整机制 - lock file、host 解析、Neovim sidecar，以及为什么 Zed 用轮询 - 见 [发现机制](../explanation/discovery.md) 和 [架构](../explanation/architecture.md)。

## 下一步

- [安装其他编辑器](../how-to/) - Zed、Neovim 或 JetBrains。
- [在 WSL2 中使用](../how-to/use-wsl2.md) - Pi 在 WSL，IDE 在 Windows。
- [配置参考](../reference/configuration.md) - 环境变量、快捷键、`fixPrompt` 和 `status_display`。
- [`/ide` 命令参考](../reference/commands.md) - 在 TUI 中管理连接。
