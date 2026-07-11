# 安装 JetBrains 插件

Pi × IDE 通过 Marketplace 插件集成 IntelliJ IDEA、PyCharm、WebStorm 等 JetBrains IDE。

## 前置条件

- 已安装 [`pi`](https://github.com/earendil-works/pi-coding-agent) CLI。
- 已安装 Pi 包：`pi install npm:pi-x-ide`。
- JetBrains IDE（建议 2024.2 或更高）。

## 从 JetBrains Marketplace 安装

1. 在 IDE 中打开 **Settings / Preferences -> Plugins -> Marketplace**。
2. 搜索 `balaenis.pi-x-ide`。
3. 点击 **Install**，按提示重启 IDE。

插件也列在 [JetBrains Marketplace](https://plugins.jetbrains.com/plugin/32664-pi-x-ide)。

## 验证连接

1. 在 JetBrains IDE 中打开项目。
2. 在该项目中打开终端并启动 Pi：

   ```bash
   pi
   ```

3. 打开源文件并选中文本。Pi widget 应显示：

   ```
   ⧉ ⇡ foo.ts#L10-L20
   ```

如果 widget 没出现，见 [排查连接问题](troubleshoot-connection.md)。

## 附加选区

在编辑器中选中文本后，任选其一：

- 按 `Ctrl+Alt+K`（Linux/Windows）或 `Cmd+Alt+K`（macOS）。
- 在 Find Action 对话框（`Ctrl+Shift+A` / `Cmd+Shift+A`）中运行 **Pi x IDE: Attach Selection**。

Pi 把 `@relative/path#Lx-Ly` 插入输入框。提交消息即可把选中文本作为 LLM 上下文发送。

## 注意

- JetBrains 对非空选区和"有活跃文件但无选中文本"两种情况都会发送选区通知。
- 诊断 Quick Fix 和自动安装是 VS Code 系列功能，JetBrains 不支持。见 [功能对比](../reference/feature-parity.md)。
- 本地开发和 sandbox 测试见 [CONTRIBUTING.zh-CN.md](../../../CONTRIBUTING.zh-CN.md)。
