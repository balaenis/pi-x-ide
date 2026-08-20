# Troubleshoot a missing connection

The Pi widget does not appear, or it shows no IDE connection. Work through these
steps in order.

## 1. Confirm both sides are running

- The IDE extension/plugin is installed and the window was reloaded after install.
- Pi was started **from a terminal inside the IDE's workspace folder** (or the
  same project directory).

If the IDE was started _after_ Pi, reload the IDE window so it writes its lock
file, then re-attempt matching in Pi:

```
/ide auto
```

## 2. Check the lock file

The IDE plugin writes a lock file to `~/.pi/pi-x-ide/lock/`. List the directory:

```bash
ls -l ~/.pi/pi-x-ide/lock
```

You should see a file like `vscode-12345-48123.lock`, `nvim-98765-50001.lock`, or
`jetbrains-4242-51234.lock`.

- **No file at all:** the IDE extension is not running. Reload the IDE window or
  restart the IDE. For VS Code, run **Developer: Reload Window**.
- **File exists but Pi did not connect:** continue to step 3.

## 3. Check the working directory match

Pi auto-connects only when your terminal `cwd` is **inside** one of the IDE's
workspace folders. If you started Pi in a parent directory (for example `~/`),
there is no exact match. Either:

- Restart Pi from inside the project directory, or
- Run `/ide` to open the selector and pick a connection manually, or
- Run `/ide auto` to re-attempt matching.

## 4. Inspect the connection status

Run:

```
/ide status
```

This shows the current connection, workspace, and most recent selection. If it
reports no connection, run `/ide list` to see the candidate lock files Pi found.

## 5. Stale or dead lock files

If a previous IDE instance crashed, its lock file may linger. Pi keeps a lock when
authoritative PID or WSL TCP liveness succeeds. Pi uses age-only cleanup only when
authoritative liveness is unavailable or disabled.

An active VS Code, Neovim, or JetBrains producer normally recreates an externally
deleted lock on its next 15-minute heartbeat. For the mechanism, see
[How discovery works](../explanation/discovery.md).

Confirm the IDE is stopped before you delete lock files manually:

```bash
rm ~/.pi/pi-x-ide/lock/*.lock
```

Then reload or restart the producer and run `/ide auto` in Pi.

> Do **not** delete Windows-side lock files manually from WSL if the IDE is still
> running on Windows - Pi uses `runningInWindows: true` to probe them safely.

## 6. Neovim sidecar did not start

For Neovim, the widget depends on a sidecar process. See
[Install the Neovim plugin -> Troubleshoot the sidecar](install-neovim.md#troubleshoot-the-sidecar).

## 7. WSL2 cross-boundary issues

If Pi runs in WSL and the IDE runs on Windows, automatic host discovery may fail
behind restrictive networking. Set `PI_X_IDE_HOST_OVERRIDE` - see
[Use Pi × IDE over WSL2](use-wsl2.md#when-automatic-discovery-fails).

## Disable the integration

If you need to stop Pi from attaching IDE context temporarily:

```
/ide off
```

This disconnects and disables automatic context attachment. Run `/ide auto` to
re-enable it.

## Still stuck

- [How discovery works](../explanation/discovery.md) - the matching and host
  resolution rules.
- [`/ide` command reference](../reference/commands.md) - all available commands.
- [Architecture](../explanation/architecture.md) - the components and data flow.
