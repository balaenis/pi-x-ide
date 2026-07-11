# How discovery works

Pi discovers IDE connections through **lock files**: small JSON files that each
running IDE plugin writes to advertise its WebSocket endpoint. This page explains
where they live, how Pi picks the right one, and how the WSL boundary is crossed.
For the exact file schema, see the
[protocol specification](../specs/ide-protocol.md).

## The lock directory

The primary lock directory is always:

```
~/.pi/pi-x-ide/lock/
```

Each file is named `<ide>-<pid>-<port>.lock`, for example:

- `vscode-12345-48123.lock`
- `nvim-98765-50001.lock`
- `jetbrains-4242-51234.lock`

A lock file contains the IDE source, WebSocket host and port, an auth token, the
workspace folders, the process PID, and timestamps. Writers create a temp file and
rename it into place atomically; the directory is mode `0700` and files are mode
`0600`.

## How Pi picks a connection

When Pi starts, it scans every lock directory it knows about, parses each file,
and ranks the candidates. The ranking prefers a connection whose workspace
**contains** your terminal's current working directory (`relationshipMatchLength`
in `src/shared/paths.ts`):

1. A workspace folder that contains your `cwd` scores highest.
2. A workspace folder contained _by_ your `cwd` (you started Pi in a parent
   directory) scores lower.
3. No relationship scores zero.

This is why the recommended workflow is to start Pi from **inside your project
directory**: the match is exact and Pi connects automatically. If your `cwd` is
only a parent (for example `~/`), no candidate wins outright - run `/ide` to
choose one manually, or `/ide auto` to re-attempt matching.

## Lock file lifecycle

Lock files are ephemeral. Pi cleans them up:

- **Stale:** files older than 24 hours are deleted.
- **Dead process:** if the recorded PID is no longer running, the lock file is
  deleted - unless the lock declares `runningInWindows: true` and Pi is in WSL.
  In that case Pi cannot see Windows PIDs from Linux, so it TCP-probes the host
  and port before deciding to delete.
- **Malformed:** unparseable files are ignored.

When you close your IDE, the plugin removes its lock file. If the IDE crashes, Pi
reclaims the stale file on its next scan.

## WSL2: discovering an IDE on Windows

When Pi runs inside WSL and your IDE runs on native Windows, the IDE writes its
lock file to the Windows user profile. Pi scans both the Linux home lock directory
**and** Windows user profiles such as
`/mnt/c/Users/<user>/.pi/pi-x-ide/lock/`, skipping Windows system profiles.

A Windows lock file sets `runningInWindows: true`. Pi uses this flag to avoid the
dead-PID false positive described above.

### Resolving the connection host

The lock file's `host` is always `127.0.0.1`, which is correct for the IDE
process but **not** reachable from inside WSL. Pi resolves a usable host in this
order (`src/pi/ide-host.ts`):

1. **`PI_X_IDE_HOST_OVERRIDE`** - if set (in the environment or
   `~/.pi/pi-x-ide/config.json` under `env`), use it directly.
2. **WSL default gateway** - if the lock has `runningInWindows: true` and Pi is in
   WSL, parse the gateway from `ip route show` and use it only if a short TCP
   probe to `<gateway>:<port>` succeeds (500 ms timeout).
3. **The lock file `host` value** - `127.0.0.1` for same-host connections.
4. **`127.0.0.1`** - if `host` is empty.

Most WSL setups need no configuration: step 2 handles it automatically. If your
WSL networking mode, firewall, or endpoint security blocks the probe, set
`PI_X_IDE_HOST_OVERRIDE` explicitly. See [Use Pi × IDE over WSL2](../how-to/use-wsl2.md).

## Path normalization

Editor paths arriving from a Windows IDE are Windows-style. Pi normalizes them to
the Linux host before workspace matching, UI display, `@file#Lx-Ly` mention
formatting, and prompt context formatting. For example, a WSL UNC path like
`\\wsl.localhost\Ubuntu\home\user\project` becomes `/home/user/project` when Pi is
running in the `Ubuntu` distro (`src/shared/platform.ts`).

## Related

- [Architecture](architecture.md) - the end-to-end data flow and per-editor
  transports.
- [Protocol specification](../specs/ide-protocol.md) - lock file schema, handshake,
  and notification semantics.
- [Troubleshoot a missing connection](../how-to/troubleshoot-connection.md) - what
  to do when discovery does not connect.
