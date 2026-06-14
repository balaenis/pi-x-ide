# Pi x IDE

Pi x IDE connects VS Code with Pi so your active file and selected text can be sent as editor context.

## Features

- Tracks the active VS Code file for Pi
- Sends selected text ranges as context
- Provides a status bar action to attach the current selection
- Provides an editor title action to open Pi in the integrated terminal
- Supports manual attachment with a command or keyboard shortcut
- Adds a Quick Fix action, **Fix with Pi suggest**, for error and warning diagnostics

## Usage

Use the command palette and run:

```text
Pi x IDE: Attach Selection to Pi
```

Default shortcut:

- Linux/Windows: `Ctrl+Alt+K`
- macOS: `Cmd+Alt+K`

When no text is selected, Pi receives the active file reference. When text is selected, Pi receives the selected range and content.

For diagnostics, place the cursor on an error or warning, open Quick Fix, and choose **Fix with Pi suggest**. Pi receives the diagnostic details and nearby source context, then starts a diagnostic-analysis turn using the built-in prompt template. This first version does not ask for custom instructions before sending the prompt.

## Settings

| Key                  | Default   | Description                                           |
| -------------------- | --------- | ----------------------------------------------------- |
| `piXIde.rangeFormat` | `"comma"` | Line range format used for manual `@file` references. |
| `piXIde.useTmux`     | `false`   | Open `Pi Tui` with `tmux` when opening the terminal.  |
