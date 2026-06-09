# Init

创建一个 Pi 扩展包，其功能是负责和IDE(VS Code, Zed等)进行交互，获取正在编辑的文件信息，可以将选中的文本附加到用户输入的提示上下文中。

需要实现以下功能：

- 与IDE进行通信，获取当前编辑的文件信息
- 捕获用户选中的文本
- 将选中的文本附加到用户输入的提示上下文中
- 除了自动捕获，还可通过快捷键手动触发选中文本的附加功能, 例如 Ctrl+Shift+K将输出选中的文本范围：`@path/to/file#L10,20` 到 TUI 输入框中
- 自动根据 pi 启动的目录和当前IDE打开的根目录进行自动匹配。
- 同时支持 '/ide' 命令来切换当前通信的IDE。

## 阶段1：

- 先实现与 VS Code 的通讯的扩展。

功能实现逻辑参考 Opencode 项目的扩展实现方式 @/home/julian/workspace/source/opencode/docs/analysis/ide-interaction--active-file-and-selection.md
先对 Opencode 项目的扩展实现方式进行分析，理解其与 IDE 交互的机制和实现方式，然后进行移植。

特别的，通信websocket的lock文件放置在 `~/.pi/pi-x-ide` 目录下。
