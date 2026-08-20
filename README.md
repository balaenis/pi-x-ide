# Pi × IDE

**English** | [简体中文](README.zh-CN.md)

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
[5-minute tutorial](docs/tutorials/get-started.md).

## Documentation

**Learning**

- [Get started](docs/tutorials/get-started.md) — from install to your first
  attached selection

**How-to guides**

- [Install for VS Code / Cursor / Windsurf](docs/how-to/install-vscode.md)
- [Use with Zed](docs/how-to/install-zed.md)
- [Install the Neovim plugin](docs/how-to/install-neovim.md)
- [Install the JetBrains plugin](docs/how-to/install-jetbrains.md)
- [Use over WSL2](docs/how-to/use-wsl2.md)
- [Troubleshoot a missing connection](docs/how-to/troubleshoot-connection.md)

**Reference**

- [`/ide` commands](docs/reference/commands.md)
- [Configuration](docs/reference/configuration.md)
- [Feature parity](docs/reference/feature-parity.md)
- [Protocol reference](docs/reference/protocol.md)

**Explanation**

- [How discovery works](docs/explanation/discovery.md)
- [Architecture](docs/explanation/architecture.md)
- [Effect adoption (contributors)](docs/explanation/effect.md)

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for build, local testing, and release
instructions.

## Reference

- [opencode](https://github.com/anomalyco/opencode)

## License

[Apache-2.0](LICENSE)
