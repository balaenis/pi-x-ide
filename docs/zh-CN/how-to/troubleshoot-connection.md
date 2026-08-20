# 排查连接问题

Pi widget 不出现，或显示无 IDE 连接。按以下顺序排查。

## 1. 确认两侧都在运行

- IDE 扩展/插件已安装，且安装后已重新加载窗口。
- Pi 是 **从 IDE workspace 文件夹内的终端**（或同一项目目录）启动的。

如果 IDE 在 Pi **之后** 启动，重新加载 IDE 窗口让它写入 lock file，然后在 Pi 中重新匹配：

```
/ide auto
```

## 2. 检查 lock file

IDE 插件把 lock file 写到 `~/.pi/pi-x-ide/lock/`。列出目录：

```bash
ls -l ~/.pi/pi-x-ide/lock
```

应看到类似 `vscode-12345-48123.lock`、`nvim-98765-50001.lock` 或 `jetbrains-4242-51234.lock` 的文件。

- **完全没有文件：** IDE 扩展未运行。重新加载 IDE 窗口或重启 IDE。VS Code 可执行 **Developer: Reload Window**。
- **文件存在但 Pi 未连接：** 继续第 3 步。

## 3. 检查工作目录匹配

Pi 仅在终端 `cwd` **位于** IDE workspace 文件夹内时自动连接。如果在父目录（例如 `~/`）启动 Pi，没有精确匹配。任选其一：

- 从项目目录内重启 Pi，或
- 运行 `/ide` 打开选择器手动选择连接，或
- 运行 `/ide auto` 重新匹配。

## 4. 查看连接状态

运行：

```
/ide status
```

显示当前连接、workspace 和最近选区。若报告无连接，运行 `/ide list` 查看 Pi 找到的候选 lock file。

## 5. 过期或死进程 lock file

如果上一个 IDE 实例崩溃，lock file 可能残留。当权威的 PID 或 WSL TCP 活性检查成功时，Pi 会保留 lock。仅当权威活性不可用或被禁用时，Pi 才按年龄清理。

活动中的 VS Code、Neovim 或 JetBrains 生产者通常会在下一次 15 分钟心跳时重建被外部删除的 lock。机制说明见 [发现机制](../explanation/discovery.md)。

手动删除 lock file 之前，先确认 IDE 已停止：

```bash
rm ~/.pi/pi-x-ide/lock/*.lock
```

然后重新加载或重启生产者，再运行 `/ide auto`。

> 如果 IDE 仍在 Windows 上运行，**不要**从 WSL 手动删除 Windows 侧的 lock file - Pi 用 `runningInWindows: true` 安全地探测它们。

## 6. Neovim sidecar 未启动

对 Neovim，widget 依赖 sidecar 进程。见 [安装 Neovim 插件 -> 排查 sidecar](install-neovim.md#排查-sidecar)。

## 7. WSL2 跨边界问题

如果 Pi 在 WSL、IDE 在 Windows，受限网络下自动 host 发现可能失败。设置 `PI_X_IDE_HOST_OVERRIDE` - 见 [在 WSL2 中使用](use-wsl2.md#自动发现失败时)。

## 禁用集成

如果需要临时停止 Pi 附加 IDE 上下文：

```
/ide off
```

断开并关闭自动上下文附加。运行 `/ide auto` 可重新启用。

## 仍未解决

- [发现机制](../explanation/discovery.md) - 匹配和 host 解析规则。
- [`/ide` 命令参考](../reference/commands.md) - 所有可用命令。
- [架构](../explanation/architecture.md) - 组件和数据流。
