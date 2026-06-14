# Pi x IDE

Pi x IDE connects VS Code with Pi so your active file and selected text can be sent as editor context.

## Features

- Tracks the active VS Code file for Pi
- Sends selected text ranges as context
- Provides a status bar action to attach the current selection
- Provides an editor title action to open Pi in the integrated terminal
- Supports manual attachment with a command or keyboard shortcut
- Adds Quick Fix actions, **Pi: Fix it** and **Pi: Send diagnostic**, for error and warning diagnostics while Pi is connected

## Usage

Use the command palette and run:

```text
Pi x IDE: Attach Selection to Pi
```

Default shortcut:

- Linux/Windows: `Ctrl+Alt+K`
- macOS: `Cmd+Alt+K`

When no text is selected, Pi receives the active file reference. When text is selected, Pi receives the selected range and content.

For diagnostics, connect Pi first, then place the cursor on an error or warning and open Quick Fix. The Pi diagnostic actions appear only while at least one Pi client is connected. Choose **Pi: Fix it** to send the diagnostic details and nearby source context to one connected Pi client and start a diagnostic-analysis turn using the built-in prompt template. Choose **Pi: Send diagnostic** to send the same context to one connected Pi client and paste it into Pi's input box without starting a turn.

## Settings

| Key                  | Default   | Description                                           |
| -------------------- | --------- | ----------------------------------------------------- |
| `piXIde.rangeFormat` | `"comma"` | Line range format used for manual `@file` references. |
| `piXIde.useTmux`     | `false`   | Open `Pi Tui` with `tmux` when opening the terminal.  |
