# 发现机制

Pi 通过 **lock file** 发现 IDE 连接：每个运行中的 IDE 插件写入的小型 JSON 文件，用来广播自己的 WebSocket 端点。本页解释它们的位置、Pi 如何选择正确的连接，以及如何跨越 WSL 边界。确切的文件 schema 见 [协议规范](../../specs/ide-protocol.md)。

## lock 目录

主 lock 目录始终是：

```
~/.pi/pi-x-ide/lock/
```

每个文件命名为 `<ide>-<pid>-<port>.lock`，例如：

- `vscode-12345-48123.lock`
- `nvim-98765-50001.lock`
- `jetbrains-4242-51234.lock`

lock file 包含 IDE 来源、WebSocket host 和 port、auth token、workspace 文件夹、进程 PID 和时间戳。写入方先写临时文件再原子 rename；目录权限 `0700`，文件权限 `0600`。

## Pi 如何选择连接

Pi 启动时扫描它知道的所有 lock 目录，解析每个文件并为候选排序。排序优先 workspace **包含**终端当前工作目录的连接（`src/shared/paths.ts` 中的 `relationshipMatchLength`）：

1. 包含你 `cwd` 的 workspace 文件夹得分最高。
2. 被你 `cwd` **包含**的 workspace 文件夹（你在父目录启动了 Pi）得分较低。
3. 无关系得分为零。

这就是为什么推荐工作流是 **在项目目录内** 启动 Pi：匹配精确，Pi 自动连接。如果 `cwd` 只是父目录（例如 `~/`），没有候选胜出 - 运行 `/ide` 手动选择，或 `/ide auto` 重新匹配。

## lock file 生命周期

lock file 是临时的。Pi 会清理：

- **过期：** 超过 24 小时的文件会被删除。
- **死进程：** 若记录的 PID 已不在运行，lock file 会被删除 - 除非 lock 声明 `runningInWindows: true` 且 Pi 在 WSL 中。此时 Pi 从 Linux 看不到 Windows PID，会先 TCP 探测 host:port 再决定是否删除。
- **格式错误：** 无法解析的文件会被忽略。

关闭 IDE 时插件会移除自己的 lock file。IDE 崩溃时，Pi 在下次扫描时回收过期文件。

## WSL2：发现 Windows 上的 IDE

当 Pi 运行在 WSL 内、IDE 运行在原生 Windows 上时，IDE 把 lock file 写到 Windows 用户目录。Pi 同时扫描 Linux home 的 lock 目录 **和** Windows 用户目录（如 `/mnt/c/Users/<user>/.pi/pi-x-ide/lock/`），跳过 Windows 系统配置文件。

Windows lock file 设置 `runningInWindows: true`。Pi 用这个标志避免上面描述的死 PID 误判。

### 解析连接 host

lock file 的 `host` 始终是 `127.0.0.1`，对 IDE 进程正确，但 **从 WSL 内部不可达**。Pi 按以下顺序解析可用 host（`src/pi/ide-host.ts`）：

1. **`PI_X_IDE_HOST_OVERRIDE`** - 若设置（环境变量或 `~/.pi/pi-x-ide/config.json` 的 `env`），直接使用。
2. **WSL 默认网关** - 若 lock 有 `runningInWindows: true` 且 Pi 在 WSL 中，从 `ip route show` 解析网关，仅当对 `<gateway>:<port>` 的短 TCP 探测成功（500 ms 超时）时使用。
3. **lock file 的 `host` 值** - 同主机连接用 `127.0.0.1`。
4. **`127.0.0.1`** - `host` 为空时。

大多数 WSL 配置无需任何设置：第 2 步会自动处理。如果你的 WSL 网络模式、防火墙或终端安全策略阻止探测，显式设置 `PI_X_IDE_HOST_OVERRIDE`。见 [在 WSL2 中使用](../how-to/use-wsl2.md)。

## 路径规范化

来自 Windows IDE 的编辑器路径是 Windows 风格。Pi 在 workspace 匹配、UI 显示、`@file#Lx-Ly` mention 格式化和 prompt 上下文格式化之前，把它们规范化为 Linux host 路径。例如 WSL UNC 路径 `\\wsl.localhost\Ubuntu\home\user\project` 在 Pi 运行于 `Ubuntu` 发行版时变为 `/home/user/project`（`src/shared/platform.ts`）。

## 相关

- [架构](architecture.md) - 端到端数据流和各编辑器传输方式。
- [协议规范](../../specs/ide-protocol.md) - lock file schema、握手和通知语义。
- [排查连接问题](../how-to/troubleshoot-connection.md) - 发现未能连接时怎么办。
