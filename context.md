# Code Context — OpenCode VS Code 右上角图标机制

## Files Retrieved

1. **`/home/julian/workspace/source/opencode/sdks/vscode/package.json`** — 扩展清单，声明命令、菜单贡献点和图标路径
2. **`/home/julian/workspace/source/opencode/sdks/vscode/src/extension.ts`** — 扩展入口，注册命令和终端创建逻辑
3. **`/home/julian/workspace/source/opencode/sdks/vscode/images/button-dark.svg`** — 暗色主题图标
4. **`/home/julian/workspace/source/opencode/sdks/vscode/images/button-light.svg`** — 亮色主题图标

## Key Code

### 1. 贡献点声明（`package.json`）

```json
"contributes": {
  "commands": [
    {
      "command": "opencode.openTerminal",
      "title": "Open opencode",
      "icon": {
        "light": "images/button-dark.svg",
        "dark": "images/button-light.svg"
      }
    },
    {
      "command": "opencode.openNewTerminal",
      "title": "Open opencode in new tab",
      "icon": {
        "light": "images/button-dark.svg",
        "dark": "images/button-light.svg"
      }
    }
  ],
  "menus": {
    "editor/title": [
      {
        "command": "opencode.openNewTerminal",
        "group": "navigation"
      }
    ]
  }
}
```

核心机制：

- 在 `contributes.menus` 下声明 `"editor/title"` 菜单点，将命令 `opencode.openNewTerminal` 放入 `"navigation"` 组。
- **`"editor/title"`** 就是 VS Code 编辑器右上角工具栏区域。
- **`"group": "navigation"`** 使该命令以图标按钮形式显示（而不是藏在 `...` 更多菜单中）。
- 图标根据主题自动切换：亮色主题用 `button-light.svg`，暗色主题用 `button-dark.svg`。

### 2. 命令注册与终端创建（`src/extension.ts`）

```typescript
export function activate(context: vscode.ExtensionContext) {
  // 注册命令
  const openNewTerminalDisposable = vscode.commands.registerCommand("opencode.openNewTerminal", async () => {
    await openTerminal();
  });
  context.subscriptions.push(openNewTerminalDisposable);

  async function openTerminal() {
    const port = Math.floor(Math.random() * (65535 - 16384 + 1)) + 16384;
    const terminal = vscode.window.createTerminal({
      name: TERMINAL_NAME, // "opencode"
      iconPath: {
        light: vscode.Uri.file(context.asAbsolutePath("images/button-dark.svg")),
        dark: vscode.Uri.file(context.asAbsolutePath("images/button-light.svg")),
      },
      location: {
        // 在编辑器右侧分屏打开
        viewColumn: vscode.ViewColumn.Beside,
        preserveFocus: false,
      },
      env: {
        _EXTENSION_OPENCODE_PORT: port.toString(),
        OPENCODE_CALLER: "vscode",
      },
    });
    terminal.show();
    terminal.sendText(`opencode --port ${port}`);
    // 等待终端中的 opencode 服务启动，然后把当前文件路径追加到 TUI prompt
    // ...
  }
}
```

关键细节：

- 终端 `location` 使用 `vscode.ViewColumn.Beside`，在编辑器右侧**分屏**打开集成终端，不占用当前编辑区域。
- `iconPath` 给终端 tab 也设置图标。
- 启动后自动执行 `opencode --port ${port}` 命令，将 opencode CLI 运行在集成终端中。
- 通过随机 port（16384–65535）启动 opencode 的 HTTP 服务，然后通过 `fetch` 轮询等待服务就绪。
- 就绪后通过 `POST /tui/append-prompt` 将当前打开的文件路径（格式 `@relative/path#L1-10`）发送到 opencode TUI，实现"打开 opencode 时自动携带当前文件上下文"。

### 3. 图标 SVG

- `button-dark.svg`：白/灰色图标，深色背景
- `button-light.svg`：黑/浅灰色图标，浅色背景
- 尺寸 512×512，内容是一个带缺口的方框，表示终端/代码的抽象符号

## Architecture

```
用户点击编辑器右上角图标
        │
        ▼
VS Code 查找 "editor/title" 菜单 → 找到 opencode.openNewTerminal 命令
        │
        ▼
执行 activate() 中注册的命令回调 → openTerminal()
        │
        ├─ vscode.window.createTerminal({ name, iconPath, location: Beside, env })
        │    └─ 在编辑器右侧创建名为 "opencode" 的分屏终端
        │
        ├─ terminal.sendText("opencode --port <随机端口>")
        │    └─ 在集成终端中启动 opencode CLI
        │
        └─ 轮询 http://localhost:<port>/app 等待就绪
             └─ POST /tui/append-prompt 将当前文件 @路径 传入
                  └─ opencode TUI 显示带文件引用的 prompt
```

## Start Here

**`src/extension.ts`** — 这是扩展的唯一入口文件，包含所有命令注册和终端交互逻辑。修改或理解 opencode VS Code 集成时，首先打开这个文件。`package.json` 中的 `contributes.menus` 和 `contributes.commands` 是声明右上角图标的关键配置。

## 关键总结：如何在 VS Code 右上角添加图标按钮

两步：

1. **`package.json` 中声明菜单贡献**：

   ```json
   "contributes": {
     "commands": [
       {
         "command": "myExtension.myCommand",
         "title": "My Command Title",
         "icon": { "light": "path/to/light.svg", "dark": "path/to/dark.svg" }
       }
     ],
     "menus": {
       "editor/title": [
         { "command": "myExtension.myCommand", "group": "navigation" }
       ]
     }
   }
   ```

   - `editor/title` = 编辑器右上角工具栏
   - `group: "navigation"` = 以图标按钮形式直接显示（不加这个 group 会藏在 `...` 菜单里）

2. **在 `activate()` 中注册命令**：
   ```typescript
   vscode.commands.registerCommand("myExtension.myCommand", handler);
   ```

opencode 在此基础上进一步：点击后创建分屏终端、自动启动 opencode CLI、并智能携带当前文件上下文。
