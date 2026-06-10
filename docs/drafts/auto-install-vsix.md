# Auto Install Vsix

在一个 VSCode（或 Cursor、Windsurf 等 VSCode 体系）集成终端中启动时，自动安装扩展。

- 异步执行检测安装过程，不阻塞 pi 的启动过程
- 安装完成后，自动进行连接
- 可以通过全局变量进行控制，是否可以执行自动安装，默认开启
- 通过 `code --list-extensions --show-versions` 检查安装版本
  - 如果未安装或者低于与 pi 扩展中的内置版本，执行安装：`code --force --install-extension balaenis.pi-x-ide`

## 手动安装

可以通过 `/ide install` 选择安装的 IDE:

- 与 IDE 是否安装了 `pi-x-ide` 扩展无关，你需要检测当前运行的 IDE 进程是否安装了 `pi-x-ide`，有多个符合条件的 IDE 可以安装扩展时，
  提供一个列表给用户选择需要安装扩展的 IDE，然后使用对应 IDE 的安装指令进行安装：`code / cursor / windsurf`
