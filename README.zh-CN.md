# Pi × IDE

[English](README.md) | **简体中文**

> 用于 IDE 选区上下文集成的 Pi 扩展包。

自动将 VS Code、Zed、Neovim 和 JetBrains IDE 中当前打开或选中的文件与文本范围附加到 Pi TUI，并作为对话上下文提交给 LLM。

<img width="3822" height="2010" alt="pi-x-ide-guide" src="https://github.com/user-attachments/assets/70abe40d-e4ac-4c2e-aca7-80d2e7867945" />

## 快速开始

```bash
pi install npm:pi-x-ide
```

为你的编辑器安装 IDE 扩展，然后在项目目录中启动 Pi：

```bash
pi
```

打开文件、选中文本，在 Pi TUI 中按 `Ctrl+Alt+K` 即可将其作为 `@src/foo.ts#L10-L20` 附加。初次使用？跟着 [5 分钟教程](docs/zh-CN/tutorials/get-started.md) 走一遍。

## 文档

**学习**

- [入门指南](docs/zh-CN/tutorials/get-started.md) - 从安装到第一次附加选区

**操作指南**

- [安装 VS Code / Cursor / Windsurf 扩展](docs/zh-CN/how-to/install-vscode.md)
- [在 Zed 中使用](docs/zh-CN/how-to/install-zed.md)
- [安装 Neovim 插件](docs/zh-CN/how-to/install-neovim.md)
- [安装 JetBrains 插件](docs/zh-CN/how-to/install-jetbrains.md)
- [在 WSL2 中使用](docs/zh-CN/how-to/use-wsl2.md)
- [排查连接问题](docs/zh-CN/how-to/troubleshoot-connection.md)

**参考**

- [`/ide` 命令](docs/zh-CN/reference/commands.md)
- [配置](docs/zh-CN/reference/configuration.md)
- [功能对比](docs/zh-CN/reference/feature-parity.md)
- [协议参考](docs/zh-CN/reference/protocol.md)

**说明**

- [发现机制](docs/zh-CN/explanation/discovery.md)
- [架构](docs/zh-CN/explanation/architecture.md)
- [Effect 采用说明（贡献者）](docs/zh-CN/explanation/effect.md)

## 开发

构建、本地测试与发布说明见 [CONTRIBUTING.zh-CN.md](CONTRIBUTING.zh-CN.md)。

## 参考

- [opencode](https://github.com/anomalyco/opencode)

## 许可证

[Apache-2.0](LICENSE)
