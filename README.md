# Pi × IDE

> Pi extension package for IDE selection context integration.

Automatically attaches the currently opened or selected file and text range from
VS Code, Zed, Neovim, and JetBrains IDEs to the Pi TUI, submitting them as
conversation context to the LLM.

<img width="3822" height="2010" alt="pi-x-ide-guide" src="https://github.com/user-attachments/assets/70abe40d-e4ac-4c2e-aca7-80d2e7867945" />

## Quick start

```bash
pi install npm:pi-x-ide
```

Install the IDE extension for your editor, then start Pi from your project
directory:

```bash
pi
```

Open a file, select some text, and press `Ctrl+Alt+K` in the Pi TUI to attach it
as `@src/foo.ts#L10-L20`. New to Pi × IDE? Follow the
[5-minute tutorial](https://github.com/balaenis/pi-x-ide/blob/main/docs/tutorials/get-started.md).

## Documentation

> Links point to the [GitHub repository](https://github.com/balaenis/pi-x-ide) so
> they resolve from npm as well.

**Learning**

- [Get started](https://github.com/balaenis/pi-x-ide/blob/main/docs/tutorials/get-started.md)

**How-to guides**

- [Install for VS Code / Cursor / Windsurf](https://github.com/balaenis/pi-x-ide/blob/main/docs/how-to/install-vscode.md)
- [Use with Zed](https://github.com/balaenis/pi-x-ide/blob/main/docs/how-to/install-zed.md)
- [Install the Neovim plugin](https://github.com/balaenis/pi-x-ide/blob/main/docs/how-to/install-neovim.md)
- [Install the JetBrains plugin](https://github.com/balaenis/pi-x-ide/blob/main/docs/how-to/install-jetbrains.md)
- [Use over WSL2](https://github.com/balaenis/pi-x-ide/blob/main/docs/how-to/use-wsl2.md)
- [Troubleshoot a missing connection](https://github.com/balaenis/pi-x-ide/blob/main/docs/how-to/troubleshoot-connection.md)

**Reference**

- [`/ide` commands](https://github.com/balaenis/pi-x-ide/blob/main/docs/reference/commands.md)
- [Configuration](https://github.com/balaenis/pi-x-ide/blob/main/docs/reference/configuration.md)
- [Feature parity](https://github.com/balaenis/pi-x-ide/blob/main/docs/reference/feature-parity.md)
- [Protocol reference](https://github.com/balaenis/pi-x-ide/blob/main/docs/reference/protocol.md)

**Explanation**

- [How discovery works](https://github.com/balaenis/pi-x-ide/blob/main/docs/explanation/discovery.md)
- [Architecture](https://github.com/balaenis/pi-x-ide/blob/main/docs/explanation/architecture.md)

中文文档见
[README.zh-CN.md](https://github.com/balaenis/pi-x-ide/blob/main/README.zh-CN.md).

## Development

See [CONTRIBUTING.md](https://github.com/balaenis/pi-x-ide/blob/main/CONTRIBUTING.md)
for build, local testing, and release instructions.

## Acknowledgments

- [opencode](https://github.com/anomalyco/opencode)

## License

[Apache-2.0](https://github.com/balaenis/pi-x-ide/blob/main/LICENSE)
