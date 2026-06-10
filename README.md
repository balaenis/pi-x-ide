# Pi × IDE

Pi extension package for IDE selection context integration.

Automatically pushes the currently opened or selected file and text range in VS Code to the Pi TUI, submitting them as conversation context to the LLM.

## Prerequisites

- Node.js ≥ 20
- pnpm ≥ 11 (declared as `pnpm@11.5.2` in `packageManager`)
- VS Code ≥ 1.90 (VS Code extension only)
- Pi CLI (`@earendil-works/pi-coding-agent ≥ 0.79`)

## Install & Build

```bash
pnpm install
pnpm build
```

Common commands:

| Command               | Description                                                                      |
| --------------------- | -------------------------------------------------------------------------------- |
| `pnpm build`          | Build Pi-side TypeScript → `dist/` + VS Code-side esbuild bundle → `vscode/out/` |
| `pnpm typecheck`      | Type-check only (no output files)                                                |
| `pnpm test`           | Build + run unit tests                                                           |
| `pnpm package:vscode` | Package VS Code extension as VSIX                                                |
| `pnpm vsix`           | Alias for `pnpm package:vscode`                                                  |

## Testing the VS Code Extension Locally

### Option 1: F5 Extension Development Host (Recommended)

1. Open the **project root** in VS Code.
2. Go to the **Run and Debug** panel (`Ctrl+Shift+D`).
3. Select **Run Pi x IDE VS Code Extension**.
4. Press **F5**:
   - The `preLaunchTask` will automatically run `pnpm build`.
   - A new VS Code window titled `[Extension Development Host]` opens.

### Option 2: Package VSIX and Install

```bash
pnpm package:vscode
code --install-extension './vscode'-0.1.0.vsix
```

The extension installed this way runs in all VS Code windows, independent of the F5 Extension Host.

### Verify the Extension is Running

```bash
ls -l ~/.pi/pi-x-ide
```

You should see a file like `vscode-12345-48123.lock`.

If not, run **Developer: Reload Window** in VS Code.

## Connecting to Pi

Start Pi in the **same project directory**:

```bash
pi -e ./src/pi/index.ts
```

The Pi TUI should display:

- Footer: `IDE: vscode ✓`
- A widget below the input box showing: IDE name, workspace, current file, selection range, and `pending/sent` status

When Pi starts from a supported VS Code-family integrated terminal, it also tries to auto-install or update the Marketplace extension `balaenis.pi-x-ide` asynchronously. This does not block Pi startup. To disable only this install attempt, set:

```bash
PI_X_IDE_AUTO_INSTALL=0
```

If VS Code was started after Pi, run the following in Pi:

```
/ide auto
```

If auto-install succeeds but no connection appears, reload the IDE window and run `/ide auto` again. You can also run `/ide install` to choose a supported `code`, `cursor`, or `windsurf` CLI manually.

## Feature Verification

### Live Selection

Open a file in VS Code and select some text. The Pi TUI widget should update in real time:

```
IDE: vscode ✓ src/foo.ts#L10,20 pending
```

### Manual Keyboard Shortcut

Select text in VS Code and press:

- Linux/Windows: `Ctrl+Alt+K`
- macOS: `Cmd+Alt+K`

The Pi input box should insert:

```
@src/foo.ts#L10,20
```

### LLM Context Injection

Type a normal chat prompt in Pi. When you submit it to the LLM, the currently `pending` selected text is temporarily injected as a `context` event — it does not persist in the session history.

After submission, the TUI displays `sent`.

## `/ide` Command Reference

| Command        | Behavior                                                          |
| -------------- | ----------------------------------------------------------------- |
| `/ide`         | Open the TUI selector to list available IDE connections           |
| `/ide status`  | Show current connection, workspace, and most recent selection     |
| `/ide list`    | List candidate connections from the lock directory                |
| `/ide auto`    | Re-attempt automatic matching by `cwd` and connect                |
| `/ide off`     | Disconnect and disable automatic context attachment               |
| `/ide attach`  | Manually insert the latest selection range into the input box     |
| `/ide install` | Install or update `balaenis.pi-x-ide` through a supported IDE CLI |

## Lock File Protocol

After the IDE WebSocket server starts, connection information is written to `~/.pi/pi-x-ide/`.

Pi uses `ctx.cwd` to find the longest path match against `workspaceFolders` in the lock files, selecting the best-matching and most recent IDE connection.

See [docs/specs/ide-protocol.md](docs/specs/ide-protocol.md) for protocol details.

## Release

This project uses [Release Please](https://github.com/googleapis/release-please) with [Conventional Commits](https://www.conventionalcommits.org/) to automate versioning and publishing.

See [RELEASE.md](RELEASE.md) for the full release guide.

## VS Code Configuration

| Key                  | Type                  | Default   | Description                                   |
| -------------------- | --------------------- | --------- | --------------------------------------------- |
| `piXIde.rangeFormat` | `"comma"` \| `"dash"` | `"comma"` | File reference format for the manual shortcut |
