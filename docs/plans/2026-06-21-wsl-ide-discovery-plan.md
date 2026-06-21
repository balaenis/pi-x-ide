# WSL IDE Discovery Implementation Plan

**Goal:** Make pi-x-ide discover and connect to IDE plugins across WSL2 and Windows boundaries with Claude Code-style lock directory scanning, host resolution, and path normalization.

**Inputs:** User request to analyze how Claude Code connects without a `host` field; local Claude Code evidence from `~/.claude/ide/*.lock`, `~/.vscode-server/extensions/anthropic.claude-code-2.1.183-linux-x64/extension.js`, and the decompiled `~/.local/share/claude/versions/2.1.177` CLI; current pi-x-ide evidence from `src/shared/lock-file.ts`, `src/pi/discovery.ts`, `src/pi/connection.ts`, `src/pi/zed.ts`, `src/shared/paths.ts`, `src/shared/format.ts`, `ide-plugins/vscode/src/lock-file.ts`, and `ide-plugins/jetbrains/src/main/kotlin/com/balaenis/pixide/lock/PiXIdeLockFileManager.kt`.

**Assumptions:**

- Preserve the existing pi-x-ide lock-file protocol shape for compatibility: keep `host`, keep `port` in the JSON body, and keep filenames like `vscode-<pid>-<port>.lock`, `nvim-<pid>-<port>.lock`, and `jetbrains-<pid>-<port>.lock`.
- Add optional metadata (`runningInWindows`) instead of bumping `PROTOCOL_VERSION`, because old Pi clients can safely ignore the new field and new Pi clients can still read old lock files.
- The first implementation targets Pi running inside WSL2 while an IDE plugin runs either inside the same WSL distro or on the Windows side. Other remote development topologies remain best-effort unless covered by tests.
- `PI_X_IDE_HOST_OVERRIDE` is the supported escape hatch for users with custom WSL networking, firewalls, mirrored networking, or corporate endpoint security that blocks gateway access.

**Architecture:** Keep IDE plugins as local WebSocket servers and keep lock files as the service discovery mechanism. Pi will expand discovery from one lock directory to a prioritized list of lock directories, including Windows user lock directories when Pi runs under WSL. Connection host selection moves from "always trust `lock.host`" to "resolve the best host for this Pi process": environment override first, WSL Windows-gateway probing for `runningInWindows` locks second, and `lock.host`/`127.0.0.1` fallback last. Incoming paths and workspace folders are normalized to the Pi host before matching, UI display, `@file#Lx-Ly` mentions, and prompt context formatting.

**Tech Stack:** TypeScript, Node.js `net`/`child_process`/`fs`, existing pi-x-ide JSON-RPC over WebSocket protocol, Kotlin/JVM JetBrains plugin, VS Code extension runtime, Bun test runner, Gradle/IntelliJ Platform plugin tests, Prettier, ESLint.

---

## File Map

- Create: `src/shared/platform.ts` — shared host-platform helpers for WSL detection, Windows/UNC-to-WSL path normalization, and Windows user directory candidate discovery.
- Create: `src/pi/ide-host.ts` — Pi-side IDE WebSocket host resolver with `PI_X_IDE_HOST_OVERRIDE`, WSL default-route parsing, and TCP reachability probing.
- Modify: `src/shared/protocol.ts` — add optional `runningInWindows?: boolean` to `IdeLockFile` while keeping `host` and `port` required.
- Modify: `src/shared/schema.ts` — accept absent or boolean `runningInWindows` in lock files and reject non-boolean values.
- Modify: `src/shared/lock-file.ts` — set `runningInWindows` on TypeScript IDE lock files, with an injectable override for tests.
- Modify: `src/shared/paths.ts` — expose multi-directory lock discovery helpers and use host-aware path normalization in workspace relationship checks.
- Modify: `src/shared/format.ts` — format range mentions and editor context from normalized Pi-host paths when snapshots have already been normalized.
- Modify: `src/pi/discovery.ts` — scan multiple lock directories under WSL, avoid deleting Windows-side locks solely because `process.kill(pid, 0)` fails in WSL, and rank candidates after path normalization.
- Modify: `src/pi/connection.ts` — resolve the actual connection host before opening the WebSocket and normalize incoming selection snapshot paths before callbacks.
- Modify: `src/pi/zed.ts` — replace local WSL/path helpers with imports from `src/shared/platform.ts` while preserving Zed behavior.
- Modify: `src/shared/config-options.ts` — register `PI_X_IDE_HOST_OVERRIDE` so it can be configured via `~/.pi/config.json` environment overlays.
- Regenerate: `schemas/config.json` — keep the public config schema in sync after adding `PI_X_IDE_HOST_OVERRIDE`.
- Modify: `ide-plugins/vscode/src/lock-file.ts` — rely on shared lock-file creation so VS Code lock files include `runningInWindows`.
- Modify: `ide-plugins/jetbrains/src/main/kotlin/com/balaenis/pixide/protocol/PiXIdeProtocol.kt` — add `runningInWindows` to the JetBrains lock-file data class.
- Modify: `ide-plugins/jetbrains/src/main/kotlin/com/balaenis/pixide/lock/PiXIdeLockFileManager.kt` — set `runningInWindows = System.getProperty("os.name").startsWith("Windows", ignoreCase = true)` in JetBrains lock files.
- Create: `ide-plugins/jetbrains/src/main/kotlin/com/balaenis/pixide/util/PiXIdeWslPath.kt` — parse Windows WSL UNC project paths and convert them to WSL Linux paths for terminal launch decisions.
- Modify: `ide-plugins/jetbrains/src/main/kotlin/com/balaenis/pixide/actions/PiXIdeOpenTerminalAction.kt` — run `wsl.exe -d <distro> --cd <linux-path> pi` when the project base path is a WSL UNC path on Windows.
- Modify: `README.md` — document WSL2 behavior, the host override variable, and JetBrains/VS Code Windows-side lock discovery.
- Modify: `README.zh-CN.md` — mirror the WSL2 behavior documentation in Chinese.
- Modify: `docs/specs/ide-protocol.md` — document optional `runningInWindows`, host-resolution behavior, and WSL lock-directory scanning.
- Modify: `ide-plugins/jetbrains/README.md` — add JetBrains WSL2 manual smoke-test steps.
- Test: `test/shared.test.ts` — lock-file schema, runningInWindows metadata, path normalization, and mention formatting coverage.
- Test: `test/connection.test.ts` — host resolution and WebSocket connection behavior with WSL/Windows-side lock metadata.
- Test: `test/zed.test.ts` — ensure Zed WSL path and DB detection keep working after helper extraction.
- Test: `test/ide-server.test.ts` or `test/connection.test.ts` — ensure host override and resolved host are used without changing WebSocket auth.
- Test: `ide-plugins/jetbrains/src/test/kotlin/com/balaenis/pixide/lock/PiXIdeLockFileManagerTest.kt` — JetBrains lock-file metadata includes `runningInWindows` when injected/tested as Windows.
- Test: `ide-plugins/jetbrains/src/test/kotlin/com/balaenis/pixide/util/PiXIdeWslPathTest.kt` — WSL UNC path parsing and `wsl.exe` command construction.

## Tasks

### Task 1: Add Backward-Compatible Lock Metadata

**Outcome:** All IDE lock files can declare whether the IDE server is running on Windows, without breaking existing lock readers or requiring a protocol version bump.

**Files:**

- Modify: `src/shared/protocol.ts`
- Modify: `src/shared/schema.ts`
- Modify: `src/shared/lock-file.ts`
- Modify: `ide-plugins/vscode/src/lock-file.ts`
- Modify: `ide-plugins/jetbrains/src/main/kotlin/com/balaenis/pixide/protocol/PiXIdeProtocol.kt`
- Modify: `ide-plugins/jetbrains/src/main/kotlin/com/balaenis/pixide/lock/PiXIdeLockFileManager.kt`
- Test: `test/shared.test.ts`
- Test: `ide-plugins/jetbrains/src/test/kotlin/com/balaenis/pixide/lock/PiXIdeLockFileManagerTest.kt`

**Steps:**

- [ ] Add `runningInWindows?: boolean` to `IdeLockFile` in `src/shared/protocol.ts`.
- [ ] Update `isIdeLockFile()` in `src/shared/schema.ts` so `runningInWindows` is accepted when absent or boolean, and rejected when it is a string, number, or object.
- [ ] Extend `CreateIdeLockFileOptions` in `src/shared/lock-file.ts` with `runningInWindows?: boolean`; set the lock field to `options.runningInWindows ?? process.platform === "win32"`.
- [ ] Keep `host: "127.0.0.1"` in `createIdeLockFile()` for compatibility; do not rename lock files to `<port>.lock`.
- [ ] Keep `ide-plugins/vscode/src/lock-file.ts` using `createIdeLockFile()` so VS Code lock files automatically inherit the metadata.
- [ ] Add `runningInWindows: Boolean = System.getProperty("os.name").startsWith("Windows", ignoreCase = true)` to JetBrains `IdeLockFile` construction.
- [ ] Add a JetBrains lock manager constructor parameter or test seam for `runningInWindows` so tests can assert both `true` and `false` without depending on the host OS.
- [ ] Add `test/shared.test.ts` coverage for lock files with no `runningInWindows`, `runningInWindows: true`, `runningInWindows: false`, and invalid `runningInWindows: "true"`.
- [ ] Add JetBrains Kotlin test coverage asserting the JSON lock file contains `"runningInWindows":true` when the test seam is set to Windows.

**Validation:**

- Run: `bun run typecheck`
- Expected: TypeScript compiles with the optional lock-file field.
- Run: `bun run test -- test/shared.test.ts`
- Expected: New schema tests pass and existing lock-file tests still pass.
- Run: `cd ide-plugins/jetbrains && ./gradlew test --tests com.balaenis.pixide.lock.PiXIdeLockFileManagerTest -PlocalIdePath=$HOME/.cache/pi-x-ide/idea-2026.1.3`
- Expected: JetBrains lock-file tests pass and generated JSON includes the new boolean field.

### Task 2: Extract Shared WSL and Path Normalization Helpers

**Outcome:** WSL detection and Windows/UNC path normalization are reusable across Zed, discovery, connection, formatting, and tests.

**Files:**

- Create: `src/shared/platform.ts`
- Modify: `src/pi/zed.ts`
- Modify: `src/shared/paths.ts`
- Test: `test/zed.test.ts`
- Test: `test/shared.test.ts`

**Steps:**

- [ ] Create `src/shared/platform.ts` with ABOUTME headers and export `isWsl(env = process.env): boolean` using the current `src/pi/zed.ts` logic: `WSL_DISTRO_NAME`, `WSL_INTEROP`, and `/proc/version` when the environment is the real process environment.
- [ ] Move the current `normalizeZedPathForHost()` drive-letter and WSL UNC conversion into a generic `normalizePathForHost(input: string, env = process.env): string`.
- [ ] Ensure `normalizePathForHost()` converts `C:\Users\me\repo` to `/mnt/c/Users/me/repo` only under WSL.
- [ ] Ensure `normalizePathForHost()` converts `\\wsl$\Ubuntu\home\julian\repo` and `\\wsl.localhost\Ubuntu\home\julian\repo` to `/home/julian/repo` when `WSL_DISTRO_NAME=Ubuntu`.
- [ ] Ensure `normalizePathForHost()` leaves WSL UNC paths for other distros unchanged when `WSL_DISTRO_NAME` does not match.
- [ ] Update `src/pi/zed.ts` to import `isWsl` and `normalizePathForHost` from `src/shared/platform.ts`; keep an exported `normalizeZedPathForHost()` wrapper if existing tests or public internals import it.
- [ ] Update `src/shared/paths.ts` so `relationshipMatchLength()` and `toRelativeDisplayPath()` can use normalized paths by default on WSL without changing non-WSL behavior.
- [ ] Add `test/shared.test.ts` cases for generic path normalization using Windows drive paths and WSL UNC paths.
- [ ] Keep the existing `test/zed.test.ts` cases for WSL path normalization passing unchanged or update their imports to the wrapper.

**Validation:**

- Run: `bun run test -- test/shared.test.ts test/zed.test.ts`
- Expected: Existing Zed path tests still pass and new generic path-normalization tests pass.
- Run: `bun run typecheck`
- Expected: TypeScript compiles with the helper extraction.

### Task 3: Discover Windows-Side Lock Directories from WSL

**Outcome:** When Pi runs inside WSL, `/ide list`, `/ide auto`, and automatic startup can see lock files written by Windows-side VS Code or JetBrains plugins.

**Files:**

- Modify: `src/shared/paths.ts`
- Modify: `src/pi/discovery.ts`
- Test: `test/shared.test.ts`
- Test: `test/connection.test.ts` or `test/ide-server.test.ts`

**Steps:**

- [ ] Add `resolveLockDirs(options)` to `src/shared/paths.ts` or `src/pi/discovery.ts`, returning a de-duplicated list of lock directories.
- [ ] Preserve current behavior for normal operation: the first lock directory is always `resolveLockDir()` (`~/.pi/pi-x-ide/lock`).
- [ ] Preserve test overrides: if `DiscoverOptions.lockDir` is provided, scan only that directory so current tests stay deterministic.
- [ ] Under WSL, append Windows user lock directories matching `/mnt/c/Users/<user>/.pi/pi-x-ide/lock`.
- [ ] Skip Windows system profile names: `Public`, `Default`, `Default User`, and `All Users`.
- [ ] Deduplicate directories by real path when possible and by resolved path otherwise.
- [ ] Change `discoverIdeCandidates()` to iterate all resolved lock directories and collect candidates from each directory.
- [ ] Keep invalid and stale JSON cleanup local to the directory where the invalid file was found.
- [ ] Change PID cleanup so a Windows-side lock (`runningInWindows: true`) discovered from WSL is not deleted merely because `process.kill(pid, 0)` fails. Use max-age cleanup and WebSocket connection failures for stale Windows-side locks.
- [ ] Add tests that create two temporary lock directories, each with a valid lock, and assert `discoverIdeCandidates()` returns candidates sorted by match length, mtime, and path across directories.
- [ ] Add tests that simulate WSL with a temporary `/mnt/c/Users` substitute and assert Windows-side lock directories are included and system profiles are skipped.
- [ ] Add tests that simulate WSL plus `runningInWindows: true` plus an unreachable Windows PID and assert discovery does not delete the lock at PID-check time.

**Validation:**

- Run: `bun run test -- test/shared.test.ts test/connection.test.ts test/ide-server.test.ts`
- Expected: Discovery sees candidates across multiple directories, deterministic test overrides still work, and Windows-side locks are not removed during WSL PID checks.
- Run: `bun run typecheck`
- Expected: `DiscoverOptions` and candidate sorting compile cleanly.

### Task 4: Resolve IDE WebSocket Hosts Like Claude Code

**Outcome:** Pi connects to the correct IDE WebSocket host for same-namespace, WSL Remote, and Windows-IDE/WSL-Pi scenarios.

**Files:**

- Create: `src/pi/ide-host.ts`
- Modify: `src/pi/connection.ts`
- Modify: `src/pi/discovery.ts`
- Modify: `src/shared/config-options.ts`
- Regenerate: `schemas/config.json`
- Test: `test/connection.test.ts`
- Test: `test/shared.test.ts`

**Steps:**

- [ ] Create `src/pi/ide-host.ts` with ABOUTME headers.
- [ ] Export `PI_X_IDE_HOST_OVERRIDE_ENV = "PI_X_IDE_HOST_OVERRIDE"`.
- [ ] Implement `resolveIdeHost(lock, options)` with this order: configured env override, WSL+`runningInWindows` gateway probe, `lock.host`, then `127.0.0.1`.
- [ ] Resolve the configured override through existing `resolvePiConfigEnv()` so `PI_X_IDE_HOST_OVERRIDE` works as a real environment variable and through `~/.pi/pi-x-ide/config.json`.
- [ ] Implement the WSL gateway probe by running `ip route show`, extracting `default via <IPv4>`, and checking TCP reachability to `<IPv4>:lock.port` with a short timeout of 500 ms.
- [ ] If the gateway probe fails, fall back to `lock.host` instead of throwing; connection failure should still be reported by `IdeConnection`.
- [ ] Inject the command runner and TCP probe in tests so host resolution does not depend on the developer's actual network.
- [ ] Modify `IdeConnection.connect()` to call `resolveIdeHost(lock)` and connect to `ws://<resolvedHost>:<lock.port>` while keeping the existing `x-pi-x-ide-authorization` header.
- [ ] Update `IdeConnectionTimeoutError` to include the resolved host in the message so troubleshooting reports the actual attempted target.
- [ ] In discovery stale cleanup, use the same host resolver and TCP probe only when deciding whether to delete a Windows-side lock from WSL after a failed local PID check.
- [ ] Register `PI_X_IDE_HOST_OVERRIDE` in `src/shared/config-options.ts` with a clear description: "Override the host Pi uses to connect to IDE WebSocket lock files. Useful for WSL2 or custom networking."
- [ ] Regenerate `schemas/config.json` with `bun run generate:config-schema`.
- [ ] Add unit tests for same-host locks, WSL+Windows locks with a reachable gateway, WSL+Windows locks with an unreachable gateway falling back to `lock.host`, and config/env host override taking precedence.

**Validation:**

- Run: `bun run test -- test/connection.test.ts test/shared.test.ts`
- Expected: Host resolver tests cover override, gateway success, gateway fallback, and unchanged same-host behavior.
- Run: `bun run check:config-schema`
- Expected: `schemas/config.json` is in sync with `src/shared/config-options.ts`.
- Run: `bun run typecheck`
- Expected: Connection and discovery compile with the new host resolver.

### Task 5: Normalize Incoming Selection Snapshots for the Pi Host

**Outcome:** A selection sent from a Windows-side IDE for a WSL project produces Linux paths in Pi widgets, `@file#Lx-Ly` mentions, and prompt context.

**Files:**

- Modify: `src/pi/connection.ts`
- Modify: `src/shared/paths.ts`
- Modify: `src/shared/format.ts`
- Test: `test/shared.test.ts`
- Test: `test/connection.test.ts`

**Steps:**

- [ ] Add `normalizeEditorSelectionSnapshotForHost(snapshot, env)` in `src/shared/paths.ts` or `src/shared/platform.ts`.
- [ ] Normalize `snapshot.filePath` and `snapshot.workspaceFolder` with `normalizePathForHost()` before storing or emitting the snapshot to runtime callbacks.
- [ ] Normalize each `workspaceFolders` entry from lock files before workspace matching in `discoverIdeCandidates()`.
- [ ] Ensure `formatRangeMention()` receives normalized paths so a Windows WSL UNC file inside `/home/julian/repo` formats as `@src/file.ts#L1-L2` when the Pi cwd is `/home/julian/repo`.
- [ ] Ensure `formatEditorContext()` uses the normalized file path, so model context references `/home/...` rather than `\\wsl.localhost\...` when Pi runs in WSL.
- [ ] Add tests for a JetBrains-style snapshot with `filePath = "\\\\wsl.localhost\\Ubuntu\\home\\julian\\repo\\src\\a.ts"`, `workspaceFolder = "\\\\wsl.localhost\\Ubuntu\\home\\julian\\repo"`, and `WSL_DISTRO_NAME=Ubuntu`.
- [ ] Assert the normalized mention is `@src/a.ts#L1` and the formatted context contains `/home/julian/repo/src/a.ts`.
- [ ] Add a negative test for a different distro name, ensuring the UNC path is not incorrectly converted.

**Validation:**

- Run: `bun run test -- test/shared.test.ts test/connection.test.ts`
- Expected: Mentions, context, and runtime selection callbacks use Pi-host paths under WSL.
- Run: `bun run typecheck`
- Expected: Snapshot normalization helpers compile without widening public payload types.

### Task 6: Improve JetBrains WSL Terminal Launch

**Outcome:** **Pi x IDE: Open Pi Terminal** starts Pi inside the target WSL distro when the Windows JetBrains project is a WSL UNC path.

**Files:**

- Create: `ide-plugins/jetbrains/src/main/kotlin/com/balaenis/pixide/util/PiXIdeWslPath.kt`
- Modify: `ide-plugins/jetbrains/src/main/kotlin/com/balaenis/pixide/actions/PiXIdeOpenTerminalAction.kt`
- Test: `ide-plugins/jetbrains/src/test/kotlin/com/balaenis/pixide/util/PiXIdeWslPathTest.kt`

**Steps:**

- [ ] Create `PiXIdeWslPath.kt` with ABOUTME headers.
- [ ] Implement parsing for `\\wsl$\<distro>\path\to\repo`, `\\wsl.localhost\<distro>\path\to\repo`, `//wsl$/<distro>/path/to/repo`, and `//wsl.localhost/<distro>/path/to/repo`.
- [ ] Convert parsed WSL UNC paths to a data class containing `distro` and `linuxPath`, where `\\wsl.localhost\Ubuntu\home\julian\repo` becomes `distro = "Ubuntu"` and `linuxPath = "/home/julian/repo"`.
- [ ] Add `terminalCommandForProject(basePath)` returning `listOf("wsl.exe", "-d", distro, "--cd", linuxPath, "pi")` for WSL UNC paths on Windows and `listOf("pi")` otherwise.
- [ ] Modify `PiXIdeOpenTerminalAction` to use the helper for `shellCommand(...)`.
- [ ] For WSL UNC projects, set the terminal working directory to `System.getProperty("user.home")` or the Windows user profile instead of the UNC path, because Windows shells can reject UNC working directories before `wsl.exe --cd` runs.
- [ ] Keep existing behavior unchanged for native Linux, macOS, and Windows local paths.
- [ ] Add Kotlin unit tests for UNC parsing, non-UNC fallback, and command construction.

**Validation:**

- Run: `cd ide-plugins/jetbrains && ./gradlew test --tests com.balaenis.pixide.util.PiXIdeWslPathTest -PlocalIdePath=$HOME/.cache/pi-x-ide/idea-2026.1.3`
- Expected: WSL UNC parsing and terminal command tests pass.
- Run: `cd ide-plugins/jetbrains && ./gradlew test -PlocalIdePath=$HOME/.cache/pi-x-ide/idea-2026.1.3`
- Expected: All JetBrains plugin tests pass.

### Task 7: Document WSL2 Behavior and Manual Smoke Tests

**Outcome:** Users can understand which WSL2 topologies are supported, how to override host resolution, and how to verify Windows-side IDE integration from WSL Pi.

**Files:**

- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `docs/specs/ide-protocol.md`
- Modify: `ide-plugins/jetbrains/README.md`

**Steps:**

- [ ] Document that VS Code Remote WSL works because the extension host writes Linux-side lock files and binds inside WSL.
- [ ] Document that native Windows IDEs can be discovered by WSL Pi because Pi scans `/mnt/c/Users/<user>/.pi/pi-x-ide/lock` and uses the WSL default gateway when `runningInWindows` is true.
- [ ] Document `PI_X_IDE_HOST_OVERRIDE` with examples: `PI_X_IDE_HOST_OVERRIDE=127.0.0.1 pi` and `PI_X_IDE_HOST_OVERRIDE=<windows-host-ip> pi`.
- [ ] Document the JetBrains Windows + WSL smoke test: open a `\\wsl.localhost\<distro>\home\...` project in JetBrains, confirm `C:\Users\<user>\.pi\pi-x-ide\lock\jetbrains-*.lock`, start Pi inside WSL, run `/ide list`, run `/ide auto`, select text, and use `Ctrl+Alt+K`.
- [ ] Update `docs/specs/ide-protocol.md` to state that `host` remains present for compatibility but Pi may override it when `runningInWindows` and WSL detection apply.
- [ ] Update `docs/specs/ide-protocol.md` with the optional `runningInWindows` field and the expected semantics.
- [ ] Keep docs clear that diagnostic Quick Fix for JetBrains remains out of scope.

**Validation:**

- Run: `bun run format:check`
- Expected: Markdown formatting passes.
- Run: `bun run test -- test/shared.test.ts`
- Expected: Documentation examples that mirror test fixture shapes stay consistent with schema expectations.

## Final Validation

- Run: `bun run format:check`
- Expected: All Markdown, TypeScript, JSON, and supported project files match Prettier formatting.
- Run: `bun run lint`
- Expected: ESLint passes with generated JetBrains build directories ignored.
- Run: `bun run typecheck`
- Expected: Root TypeScript and VS Code workspace TypeScript compile.
- Run: `bun run test`
- Expected: Root test suite passes, including WSL discovery, host resolution, path normalization, lock-file schema, Zed regression, and connection tests.
- Run: `cd ide-plugins/jetbrains && ./gradlew test -PlocalIdePath=$HOME/.cache/pi-x-ide/idea-2026.1.3`
- Expected: JetBrains Kotlin tests pass, including lock metadata and WSL terminal helper tests.
- Run: `cd ide-plugins/jetbrains && ./gradlew buildPlugin verifyPlugin -PlocalIdePath=$HOME/.cache/pi-x-ide/idea-2026.1.3`
- Expected: Plugin ZIP builds and Plugin Verifier reports Compatible against the configured IDEA target; existing experimental Terminal API warnings remain expected unless JetBrains promotes the API.
- Manual smoke test: run Windows JetBrains with a WSL UNC project, start Pi in the matching WSL distro, run `/ide list` and `/ide auto`, select text in JetBrains, press `Ctrl+Alt+K`, and verify Pi inserts a Linux-style `@relative/path#Lx-Ly` mention.
- Manual smoke test: run VS Code Remote WSL and confirm same-host WSL lock files still connect through `127.0.0.1` without host override.

## Rollout Notes

- This is a backward-compatible protocol extension: old lock files without `runningInWindows` remain valid, and new lock files keep `host` and `port`.
- Users with custom WSL networking can set `PI_X_IDE_HOST_OVERRIDE` in the shell or under `~/.pi/pi-x-ide/config.json` `env`.
- The implementation should not delete Windows-side lock files from WSL merely because the Windows PID is not visible to Linux.
- The JetBrains plugin ZIP must be rebuilt before Windows-side JetBrains testing because the `runningInWindows` field and WSL terminal behavior live in the plugin.
- After adding `PI_X_IDE_HOST_OVERRIDE`, update `src/shared/config-options.ts` and regenerate `schemas/config.json` in the same change.

## Risks and Mitigations

- **Windows service reachability from WSL may vary by WSL networking mode and firewall.** Mitigate by probing the WSL default gateway before using it and providing `PI_X_IDE_HOST_OVERRIDE` for manual correction.
- **Scanning `/mnt/c/Users/*` can encounter inaccessible or slow directories.** Mitigate by skipping known system profiles, catching per-directory errors, and preserving the current `lockDir` test override.
- **Windows PIDs are not meaningful to Linux `process.kill(pid, 0)`.** Mitigate by skipping PID deletion for `runningInWindows` locks under WSL and relying on max-age plus connection reachability.
- **UNC path conversion can accidentally map a different WSL distro.** Mitigate by only converting `\\wsl$\<distro>` and `\\wsl.localhost\<distro>` when `<distro>` matches `WSL_DISTRO_NAME`.
- **JetBrains Terminal APIs are still experimental in IDEA 2026.1.3.** Mitigate by keeping terminal changes localized to command construction and preserving existing Plugin Verifier coverage.
- **Changing path normalization can affect Zed behavior.** Mitigate by extracting the existing Zed logic without changing its semantics and keeping the current Zed regression tests.
