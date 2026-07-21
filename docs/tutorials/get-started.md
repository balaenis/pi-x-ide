# Get started with Pi × IDE

This tutorial walks you from a fresh install to your first IDE selection flowing
into an LLM conversation in Pi. It takes about five minutes and uses VS Code as
the vehicle — the same flow works for Cursor and Windsurf.

> Already set up and just want to attach a selection? Jump to
> [Attach the selection](#step-5-attach-the-selection-and-chat).
> Using a different editor? See the [How-to guides](../how-to/) for Zed, Neovim,
> and JetBrains.

## What you will learn

- How to install the Pi extension package and the VS Code extension.
- How to start Pi so it discovers your IDE automatically.
- How a text selection becomes LLM context.

## Before you begin

You need:

- The [`pi`](https://github.com/earendil-works/pi-coding-agent) CLI installed and
  on your `PATH`.
- VS Code, Cursor, or Windsurf installed.
- A project folder with at least one source file you can open.

## Step 1: Install the Pi extension package

```bash
pi install npm:pi-x-ide
```

This adds the `pi-x-ide` package to Pi. It is loaded automatically the next time
Pi starts — no extra wiring required.

## Step 2: Install the VS Code extension

Open your IDE's **Extensions** panel and search for
[`balaenis.pi-x-ide`](https://marketplace.visualstudio.com/items?itemName=balaenis.pi-x-ide),
then install it.

> Alternatively, run `/ide install` inside Pi's TUI — it auto-detects `code`,
> `cursor`, or `windsurf` and installs the extension for you. On startup, Pi also
> tries to auto-install the extension when it detects a supported VS Code
> integrated terminal.

Reload the IDE window after installing so the extension activates.

## Step 3: Start Pi in your project

Open a terminal **inside your IDE** (Terminal → New Terminal), then start Pi from
the same project directory your IDE workspace is using:

```bash
pi
```

Pi loads `pi-x-ide` and looks for an IDE connection. When your terminal's working
directory is inside one of the IDE's workspace folders, Pi connects automatically.
A widget appears above the Pi input box showing the connection and selection
state.

## Step 4: Open a file and select some text

Back in your IDE, open a source file and select a few lines. The Pi widget should
update in real time:

```
⧉ ⇡ foo.ts#L10-L20
```

The `⇡` marker means a selection is **pending** — Pi has noticed it but has not
attached it to a message yet.

If the widget does not appear, see
[Troubleshoot a missing connection](../how-to/troubleshoot-connection.md).

## Step 5: Attach the selection and chat

With text selected in your IDE, focus the Pi TUI and press `Ctrl+Alt+K`
(macOS: `Ctrl+Option+K`). Pi inserts a mention into the input box:

```
@src/foo.ts#L10-L20
```

Now type a question and submit it. The selected text is injected into the LLM
context for that turn. After submission, the widget marker changes to `✓`:

```
⧉ ✓ foo.ts#L10-L20
```

You can press `Ctrl+Alt+K` repeatedly to append several ranges to the same
message, or select new text between turns to attach fresh context each time.

## What just happened

When you select text, the VS Code extension broadcasts a `selection_changed`
notification over a local WebSocket to Pi. Pi caches the latest selection and
marks it pending. When you press the attach shortcut, Pi inserts the `@file#Lx-Ly`
mention into your input. When you submit the message, Pi wraps the selected text
and injects it into the user message before the LLM sees it.

For the full mechanism — lock files, host resolution, the Neovim sidecar, and why
Zed is polled differently — read [How discovery works](../explanation/discovery.md)
and [Architecture](../explanation/architecture.md).

## Where to go next

- [Install another editor](../how-to/) — Zed, Neovim, or JetBrains.
- [Use Pi × IDE over WSL2](../how-to/use-wsl2.md) — Pi in WSL, IDE on Windows.
- [Configuration reference](../reference/configuration.md) — env vars, keymaps,
  `fixPrompt`, and `status_display`.
- [`/ide` command reference](../reference/commands.md) — manage connections from
  the TUI.
