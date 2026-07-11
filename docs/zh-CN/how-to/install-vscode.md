# 安装 VS Code 扩展

Pi × IDE 通过一个扩展集成 VS Code、Cursor 和 Windsurf。本指南介绍三种安装方式和连接验证。

## 前置条件

- 已安装 [`pi`](https://github.com/earendil-works/pi-coding-agent) CLI。
- 已安装 Pi 包：`pi install npm:pi-x-ide`。
- VS Code、Cursor 或 Windsurf。

## 方式一：从 Marketplace 安装（推荐）

在 IDE 的 **扩展** 面板搜索
[`balaenis.pi-x-ide`](https://marketplace.visualstudio.com/items?itemName=balaenis.pi-x-ide)
并安装。安装后重新加载窗口。

## 方式二：通过 Pi CLI 安装

在 Pi TUI 中运行：

```
/ide install
```

Pi 自动检测 `PATH` 中的 `code`、`cursor` 或 `windsurf` CLI，并对其执行 `--force --install-extension`。

## 方式三：Pi 启动时自动安装

当 Pi 从受支持的 VS Code 集成终端启动时，会异步尝试自动安装或更新扩展。默认开启。如需关闭：

```bash
PI_X_IDE_AUTO_INSTALL=0
```

所有 Pi 侧选项见 [配置参考](../reference/configuration.md)。

## 验证连接

1. 在 IDE 中打开项目文件夹。
2. 在该项目文件夹中打开集成终端并启动 Pi：

   ```bash
   pi
   ```

3. 打开源文件并选中文本。Pi widget 应显示：

   ```
   ⧉ ⇡ foo.ts#L10-L20
   ```

如果 widget 没出现，见 [排查连接问题](troubleshoot-connection.md)。

## VS Code 设置

| 键               | 类型      | 默认值  | 说明                                                                                    |
| ---------------- | --------- | ------- | --------------------------------------------------------------------------------------- |
| `piXIde.useTmux` | `boolean` | `false` | 通过终端图标用 `tmux` 打开 Pi。每次点击都会创建一个新 session，终端 detach 后自动销毁。 |

## 诊断 Quick Fix

将光标放在 error 或 warning 上，打开 Quick Fix（`Ctrl+.`），选择：

- **Pi: Fix it** - 把诊断信息发送给 Pi 并启动分析对话。
- **Pi: Send diagnostic** - 把诊断上下文粘贴到 Pi 输入框，不启动对话。

**Pi: Fix it** 使用的 prompt 前缀可通过 `fix_prompt` 配置。见 [配置](../reference/configuration.md#顶层选项)。
