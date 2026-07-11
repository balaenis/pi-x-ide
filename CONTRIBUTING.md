# Contributing to Pi × IDE

This guide covers building the project, testing each IDE integration locally, and
cutting a release. For user-facing setup and usage, see the
[documentation](README.md#documentation).

## Prerequisites

- Node.js ≥ 26
- bun ≥ 1.3 (`packageManager` declared as `bun@1.3.14`)
- VS Code ≥ 1.120.0 (VS Code extension only)
- Neovim ≥ 0.9 (Neovim plugin only)
- JDK 21 (JetBrains plugin only; Gradle can download the toolchain automatically)

[mise](https://mise.jdx.dev/) manages the toolchain. Run `mise install` in the
repo root to install the declared versions.

## Install & build

```bash
git clone https://github.com/balaenis/pi-x-ide.git
cd pi-x-ide
mise run setup
mise run build
```

To load the local build without installing globally:

```bash
pi -e ./src/pi/index.ts
```

## Tasks

All build and check commands are defined as `mise run` tasks (see `.mise/tasks/`):

| Command                        | Description                                                                                                                   |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `mise run build`               | Build Pi-side TypeScript -> `dist/` + Neovim sidecar -> `ide-plugins/nvim/bin/` + VS Code bundle -> `ide-plugins/vscode/out/` |
| `mise run typecheck`           | Type-check only (no output files)                                                                                             |
| `mise run test`                | Build + run unit tests                                                                                                        |
| `mise run package:vsix`        | Package the VS Code extension as a VSIX                                                                                       |
| `mise run compile:jetbrains`   | Compile and test the JetBrains plugin with Gradle                                                                             |
| `mise run package:jetbrains`   | Package the JetBrains plugin ZIP under `ide-plugins/jetbrains/build/distributions/`                                           |
| `mise run verify:jetbrains`    | Run the IntelliJ Plugin Verifier for the configured target IDE                                                                |
| `mise run check:config-schema` | Verify `schemas/config.json` is in sync with the config registry                                                              |

## Test the VS Code extension locally

### Option 1: F5 Extension Development Host (recommended)

1. Open the **project root** in VS Code.
2. Go to the **Run and Debug** panel (`Ctrl+Shift+D`).
3. Select **Run Pi x IDE VS Code Extension**.
4. Press **F5**:
   - The `preLaunchTask` automatically runs `mise run build`.
   - A new VS Code window titled `[Extension Development Host]` opens.

### Option 2: Package a VSIX and install

```bash
mise run package:vsix
cd ide-plugins/vscode && code --install-extension dist/pi-x-ide-$(node -p "require('./package.json').version").vsix
```

The extension installed this way runs in all VS Code windows, independent of the
F5 Extension Development Host.

### Verify the extension is running

```bash
ls -l ~/.pi/pi-x-ide/lock
```

You should see a file like `vscode-12345-48123.lock`. If not, run
**Developer: Reload Window** in VS Code.

## Test the JetBrains plugin locally

Run a sandbox IDE:

```bash
cd ide-plugins/jetbrains
./gradlew runIde
```

Build the installable plugin ZIP:

```bash
mise run package:jetbrains
```

The ZIP is written under `ide-plugins/jetbrains/build/distributions/`. For a smoke
test, open this repository in the sandbox IDE, start `pi` from the same directory,
open and select text in a local file, then press `Ctrl+Alt+K` or run
**Pi x IDE: Attach Selection**. Pi should receive an `@relative/path#Lx-Ly`
mention.

## Configuration schema

When you add or change a Pi-side configuration option or environment variable that
should be configurable through `~/.pi/config.json`, update the registry in
`src/shared/config-options.ts` and regenerate the schema:

```bash
mise run generate:config-schema
```

Then verify it is in sync:

```bash
mise run check:config-schema
```

## Release

This project uses [Release Please](https://github.com/googleapis/release-please)
with [Conventional Commits](https://www.conventionalcommits.org/) to automate
versioning and publishing. See [RELEASE.md](RELEASE.md) for the full release guide.
