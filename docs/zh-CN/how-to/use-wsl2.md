# 在 WSL2 中使用 Pi × IDE

当 Pi 运行在 WSL2 内、IDE 运行在原生 Windows 上时，Pi × IDE 会自动跨 WSL 边界发现 IDE 连接。本指南介绍常见场景和受限网络下的手动覆盖。

## 前置条件

- WSL 内已安装 [`pi`](https://github.com/earendil-works/pi-coding-agent) CLI。
- 已安装 Pi 包：`pi install npm:pi-x-ide`。
- Windows 上运行 IDE（VS Code、Cursor、Windsurf 或 JetBrains），并已安装 `pi-x-ide` 扩展/插件。

## 连接

1. 在 Windows IDE 中打开项目。
2. 在 WSL 内 `cd` 到同一项目目录并启动 Pi：

   ```bash
   cd /mnt/c/Users/you/project
   pi
   ```

Pi 同时扫描 Linux home 的 lock 目录和 Windows 用户目录的 lock 目录。发现 Windows lock file（`runningInWindows: true`）时，自动解析可达 host（见下文）并连接。widget 出现在 Pi 输入框上方。

## host 如何解析

lock file 的 `host` 是 `127.0.0.1`，对 Windows 上的 IDE 进程正确，但从 WSL 内部不可达。Pi 按以下顺序解析可用 host：

1. **`PI_X_IDE_HOST_OVERRIDE`** - 若设置则直接使用。
2. **WSL 默认网关** - 从 `ip route show` 解析，仅当对 `<gateway>:<port>` 的短 TCP 探测成功时使用。
3. lock file 的 `host` 值，最后回退到 `127.0.0.1`。

大多数配置下第 2 步即可处理，无需任何设置。完整说明见 [发现机制](../explanation/discovery.md#解析连接-host)。

## 自动发现失败时

如果你的 WSL 网络模式、防火墙或终端安全策略阻止了网关探测，Pi 无法到达 IDE。请显式覆盖 host。

### 同机、mirrored/localhost 网络

```bash
PI_X_IDE_HOST_OVERRIDE=127.0.0.1 pi
```

### NAT 网络 - 使用 Windows host IP

```bash
PI_X_IDE_HOST_OVERRIDE=<windows-host-ip> pi
```

从 WSL 默认网关获取 Windows host IP：

```bash
ip route show | grep default
# default via 172.x.x.1 dev eth0
```

用网关地址（`172.x.x.1`）作为 `<windows-host-ip>`。

### 持久化覆盖

把变量写入 `~/.pi/pi-x-ide/config.json` 而非 shell：

```json
{
  "env": {
    "PI_X_IDE_HOST_OVERRIDE": "172.x.x.1"
  }
}
```

完整环境变量参考见 [配置](../reference/configuration.md)。

## 注意

- 来自 Windows IDE 的路径会先规范化为 Linux 路径再匹配 workspace，所以 `/mnt/c/...` 和 `C:\...` 都能匹配你的 WSL 项目目录。
- 运行在 Windows 上的 Zed 也可跨 WSL 发现；其数据库从 `/mnt/c/Users/<user>/AppData/Local/Zed/db/0-stable/db.sqlite` 读取。需要时用 `PI_X_IDE_ZED_DB` 覆盖。
