# Pi x IDE

Pi x IDE connects VS Code with Pi so your active file and selected text can be sent as editor context.

## Features

- Tracks the active VS Code file for Pi
- Sends selected text ranges as context
- Provides a status bar action to attach the current selection
- Supports manual attachment with a command or keyboard shortcut

## Usage

Use the command palette and run:

```text
Pi x IDE: Attach Selection to Pi
```

Default shortcut:

- Linux/Windows: `Ctrl+Alt+K`
- macOS: `Cmd+Alt+K`

When no text is selected, Pi receives the active file reference. When text is selected, Pi receives the selected range and content.
