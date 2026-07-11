# Use Pi × IDE over WSL2

When Pi runs inside WSL2 and your IDE runs on native Windows, Pi × IDE discovers
the IDE connection across the WSL boundary automatically. This guide covers the
common case and the manual override for restricted networking.

## Prerequisites

- The [`pi`](https://github.com/earendil-works/pi-coding-agent) CLI installed
  inside WSL.
- The `pi-x-ide` Pi package installed: `pi install npm:pi-x-ide`.
- Your IDE (VS Code, Cursor, Windsurf, or JetBrains) running on Windows, with the
  `pi-x-ide` extension/plugin installed.

## Connect

1. Open your project in the Windows IDE.
2. From inside WSL, `cd` into the same project directory and start Pi:

   ```bash
   cd /mnt/c/Users/you/project
   pi
   ```

Pi scans both the Linux home lock directory and the Windows user profile lock
directory. When it finds a Windows lock file (`runningInWindows: true`), it
resolves a reachable host automatically (see below) and connects. The widget
appears above the Pi input box.

## How the host is resolved

The lock file's `host` is `127.0.0.1`, which is correct for the IDE process on
Windows but not reachable from inside WSL. Pi resolves a usable host in this
order:

1. **`PI_X_IDE_HOST_OVERRIDE`** - if set, used directly.
2. **WSL default gateway** - parsed from `ip route show` and used only if a short
   TCP probe to `<gateway>:<port>` succeeds.
3. The lock file `host` value, then `127.0.0.1` as a final fallback.

In most setups, step 2 handles everything with no configuration. For the full
explanation, see [How discovery works](../explanation/discovery.md#resolving-the-connection-host).

## When automatic discovery fails

If your WSL networking mode, firewall, or endpoint security blocks the gateway
probe, Pi cannot reach the IDE. Override the host explicitly.

### Same machine, mirrored/localhost networking

```bash
PI_X_IDE_HOST_OVERRIDE=127.0.0.1 pi
```

### NAT networking - use the Windows host IP

```bash
PI_X_IDE_HOST_OVERRIDE=<windows-host-ip> pi
```

Find the Windows host IP from the WSL default gateway:

```bash
ip route show | grep default
# default via 172.x.x.1 dev eth0
```

Use the gateway address (`172.x.x.1`) as `<windows-host-ip>`.

### Persist the override

Set the variable in `~/.pi/pi-x-ide/config.json` instead of the shell:

```json
{
  "env": {
    "PI_X_IDE_HOST_OVERRIDE": "172.x.x.1"
  }
}
```

See [Configuration](../reference/configuration.md) for the full env reference.

## Notes

- Paths from a Windows IDE are normalized to Linux before workspace matching, so
  `/mnt/c/...` and `C:\...` both match your WSL project directory.
- Zed running on Windows is also discovered across WSL; its database is read from
  `/mnt/c/Users/<user>/AppData/Local/Zed/db/0-stable/db.sqlite`. Override with
  `PI_X_IDE_ZED_DB` if needed.
