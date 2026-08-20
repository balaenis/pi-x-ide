# Implementation Plan

**Goal:** Fix Issue #50 with one Pi stale-lock policy and a race-free 15-minute heartbeat for the VS Code, Neovim, and JetBrains lock-file producers.

**Inputs:** The requested Option 2 scope; Issue #50; the read-only review blockers A-G; repository evidence from Pi discovery, shared lock-file code, all three lock producers, current tests, shipped Neovim artifacts, documentation, and Mise tasks; the `writing-plans` and `tdd` skills.

**Assumptions:**

- The requirements confirm all public seams in this plan. No additional seam confirmation is necessary.
- `heartbeatIntervalMs` remains a programmatic Neovim and shared-scheduler test seam. It does not become CLI, environment, configuration, registry, or schema surface.
- `LockFileHeartbeatHandle.refreshNow()` after terminal stop is an ignored request. It returns the stored terminal stop promise and does not call the refresh callback.
- A refresh callback has no cancellation contract. `stop()` waits indefinitely for every refresh request accepted before terminal stop.
- The VS Code extension host and JetBrains project service have no stable unit-test harness in this repository. Their lifecycle wiring uses tested lower-level public seams, compilation, and manual runtime checks. The plan does not add a fake harness or source-text test.
- JetBrains continues to use synchronous Swing callbacks on the EDT. Synchronous terminal timer disposal before lock cleanup provides the required serialization without the TypeScript promise API.
- A failed Windows-side WSL TCP probe keeps the current removal behavior.

**Architecture:** Pi parses each lock before it applies stale-file policy. For local locks, a positive safe-integer PID is authoritative at any age when PID checking is enabled. Missing or unusable PIDs, and `checkPid: false`, use age-only cleanup. Under WSL, TCP reachability is authoritative for a `runningInWindows: true` lock.

The shared TypeScript heartbeat scheduler is the only owner of refresh serialization. Its public `LockFileHeartbeatHandle` exposes `refreshNow(): Promise<void>` and `stop(): Promise<void>`. Timer ticks and producer workspace events enter the same scheduler-owned queue. A timer tick is skipped while a refresh is active or queued. Every explicit `refreshNow()` request received before terminal stop is accepted in order. Refresh failures and `onError` failures use the same containment for both request sources. The first `stop()` marks the scheduler terminal, clears the timer, ignores later requests, drains every accepted active or queued refresh including containment, and returns one stored promise object from every call. Neovim and VS Code own no second refresh queue. JetBrains uses EDT serialization and synchronous timer disposal.

**Tech Stack:** Node.js 26, TypeScript, Effect, Node test runner, real Node timers, VS Code Extension Host, Kotlin, JDK 21, IntelliJ Platform, Swing `Timer`, Gradle, Bun, and Mise.

---

## Scope Boundaries

- Option 2 includes Pi discovery plus the VS Code, Neovim, and JetBrains lock producers.
- Zed is out of scope. Pi reads Zed state from SQLite in `src/pi/zed.ts`; Zed does not produce this lock file.
- Do not add user configuration, environment variables, CLI flags, config registry entries, or schema changes.
- Do not change protocol version `1`, the lock schema, auth-token generation, or auth-token lifetime.
- Do not add PID identity, PID start-time, executable checks, cancellation, or shutdown timeouts.
- Do not change `process.kill(pid, 0)` error semantics for a usable local PID. A thrown error still means dead.
- Do not change the shared atomic writer in `src/shared/lock-file.ts`.
- Do not refactor candidate ranking, workspace matching, host resolution, WebSocket behavior, editor selection behavior, or unrelated lifecycle code.
- Do not add source-text tests, private-helper tests, fake extension hosts, fake IntelliJ projects, fake data paths, or fake timers.
- Use real temporary lock directories in every automated writer test. Pass the temporary directory explicitly to every shared writer call.
- Do not change `schemas/config.json` or run `mise run generate:config-schema`.

## Command Evidence

- `mise run test` compiles root TypeScript and runs `node --test dist/test/*.test.js`.
- `mise run compile:vsix` builds the VS Code extension for local debugging.
- `mise run compile:jetbrains -- --tests ...` forwards focused test selectors to Gradle.
- `mise run package:nvim-sidecar` regenerates the committed Neovim sidecar bundle requested by this change.
- `mise run build` is the final aggregate build required by this plan. It includes root compile, VS Code compile, and Neovim sidecar packaging.
- `.vscode/launch.json` provides `Run Pi x IDE VS Code Extension`.
- `ide-plugins/jetbrains/gradlew` provides `runIde`.

## File Map

- Create: `src/shared/lock-file-heartbeat.ts` — export the fixed interval, shared scheduler options, public handle, serialized refresh queue, error containment, and terminal drain.
- Create: `test/lock-file-heartbeat.test.ts` — verify the shared scheduler only through `refreshNow()` and `stop()` with real timers and controllable promises.
- Modify: `src/pi/discovery.ts` — apply local PID, age-only, and WSL reachability rules in the required order.
- Modify: `test/shared.test.ts` — verify Pi discovery through `discoverIdeCandidates()` and the existing real WSL directory shape.
- Modify: `src/nvim/sidecar.ts` — retain one resolved lock directory, connect workspace events to `refreshNow()`, start the shared timer, and await terminal stop before removal.
- Modify: `test/nvim-sidecar.test.ts` — verify restoration, latest workspace state, custom-directory isolation, and post-stop non-recreation through `startNvimSidecar()`.
- Regenerate: `ide-plugins/nvim/bin/pi-x-ide-nvim-sidecar.cjs` — ship the updated shared scheduler and Neovim lifecycle runtime.
- Modify: `ide-plugins/vscode/src/extension.ts` — route workspace-folder events through the shared handle and await shared terminal drain before lock removal.
- Create: `ide-plugins/jetbrains/src/main/kotlin/com/balaenis/pixide/lock/PiXIdeLockFileHeartbeat.kt` — own the fixed 15-minute Swing heartbeat and synchronous terminal EDT disposal.
- Create: `ide-plugins/jetbrains/src/test/kotlin/com/balaenis/pixide/lock/PiXIdeLockFileHeartbeatTest.kt` — verify external-deletion recovery and post-disposal inactivity.
- Modify: `ide-plugins/jetbrains/src/main/kotlin/com/balaenis/pixide/PiXIdeProjectService.kt` — connect heartbeat start and EDT-ordered disposal to project lifecycle.
- Modify: `docs/specs/ide-protocol.md` — define normative consumer liveness and producer heartbeat rules.
- Modify: `docs/explanation/discovery.md` — explain discovery liveness and heartbeat mechanisms.
- Modify: `docs/zh-CN/explanation/discovery.md` — mirror the English mechanism explanation.
- Modify: `docs/how-to/troubleshoot-connection.md` — replace unconditional 24-hour cleanup guidance with accurate recovery actions.
- Modify: `docs/zh-CN/how-to/troubleshoot-connection.md` — mirror the English troubleshooting guidance.

### ABOUTME Rules

- Every new or modified code and test file must start with two comment lines. Each line must start with `ABOUTME: `.
- Add two-line headers to `src/shared/lock-file-heartbeat.ts`, `test/lock-file-heartbeat.test.ts`, `test/nvim-sidecar.test.ts`, `PiXIdeLockFileHeartbeat.kt`, and `PiXIdeLockFileHeartbeatTest.kt`.
- Preserve the existing two-line headers in `src/pi/discovery.ts`, `test/shared.test.ts`, `src/nvim/sidecar.ts`, `ide-plugins/vscode/src/extension.ts`, and `PiXIdeProjectService.kt`.
- Regenerate `ide-plugins/nvim/bin/pi-x-ide-nvim-sidecar.cjs` only through the packaging task. Confirm that its generated two-line `ABOUTME:` header remains present.
- Do not modify `src/shared/lock-file.ts`. Its current header state is outside scope because this plan does not change that file.
- Documentation files do not require code-file `ABOUTME:` comments.

## Seams

- **Seam:** `discoverIdeCandidates(options: DiscoverOptions): Promise<LockFileCandidate[]>` — verify retention, removal, and returned candidates without testing private PID or WSL helpers.
- **Seam:** `startLockFileHeartbeat(refresh, options)` and public `LockFileHeartbeatHandle.refreshNow(): Promise<void>` plus `stop(): Promise<void>` — verify timer recovery, explicit request ordering, shared serialization, equal containment, tick skip, terminal rejection-by-ignore, and full queue drain.
- **Seam:** `startNvimSidecar(options): Promise<NvimSidecarHandle>` and `NvimSidecarHandle.stop(): Promise<void>` — verify the complete Neovim lifecycle and correct connection to the shared handle. Internal queue/drain semantics remain proven at the shared scheduler seam.
- **Seam:** VS Code `activate()` and `deactivate()` in the committed Extension Host launch configuration — verify lifecycle wiring. Automated scheduler semantics stop at the shared public seam because the repository has no extension-host unit harness.
- **Seam:** `PiXIdeLockFileHeartbeat.start()` and synchronous `dispose()` composed with public `PiXIdeLockFileManager` methods — verify lock restoration and terminal EDT disposal.
- **Seam:** `PiXIdeProjectService.start()` and `dispose()` in an IntelliJ `runIde` sandbox — verify project lifecycle wiring.
- **Seam:** Published lifecycle text in `docs/specs/ide-protocol.md` — define normative producer and consumer behavior.
- **Seam:** Mirrored lifecycle sections in the English and Chinese discovery explanations — explain mechanisms without operational steps.
- **Seam:** Mirrored stale-lock sections in the English and Chinese troubleshooting guides — give correct user actions without restating the architecture.

## Tasks

### Task 1: Preserve an old local lock for a live PID

**Seam:** `discoverIdeCandidates(options: DiscoverOptions): Promise<LockFileCandidate[]>`

**Outcome:** A local lock with a live usable PID remains discoverable at any age. A dead usable PID is removed at any age.

**Files:**

- Modify: `src/pi/discovery.ts`
- Test: `test/shared.test.ts`

**Steps:**

- [ ] **Red:** Add `keeps an old local lock while its usable PID is alive`.
- [ ] Use named age constants and `utimes()` to put a lock above the 24-hour threshold in a real temporary `lockDir`. Use `pid: process.pid`. Assert that discovery returns the candidate and preserves the file.
- [ ] In the same public-seam scenario, replace it with a fresh lock that has deterministic non-running usable PID `2_147_483_647`. Assert that discovery removes it.
- [ ] **Green:** Parse the lock before age cleanup. For a non-WSL-Windows lock with a numeric PID and `checkPid: true`, run the existing process check before age-only policy.
- [ ] Keep a live PID at every age. Remove a dead PID at every age. Preserve malformed-lock removal.
- [ ] Do not add safe-integer validation. Task 2 must remain red.
- [ ] Keep Windows-side WSL locks on the old age-first path. Task 3 must remain red.

**Validation:**

- Run (red): `mise run compile && node --test --test-name-pattern='keeps an old local lock while its usable PID is alive' dist/test/shared.test.js`
- Expected: The test fails because current discovery removes the old lock before it checks the live PID.
- Run (green): `mise run compile && node --test --test-name-pattern='keeps an old local lock while its usable PID is alive' dist/test/shared.test.js`
- Expected: The old live-PID lock remains and the fresh dead-PID lock is removed.

### Task 2: Use age-only cleanup without a usable local PID

**Seam:** `discoverIdeCandidates(options: DiscoverOptions): Promise<LockFileCandidate[]>`

**Outcome:** Only a positive safe integer is a usable local PID. Missing or unusable PIDs and `checkPid: false` use age-only cleanup.

**Files:**

- Modify: `src/pi/discovery.ts`
- Test: `test/shared.test.ts`

**Steps:**

- [ ] **Red:** Add `uses age-only cleanup when no usable local PID exists`.
- [ ] In a real temporary `lockDir`, cover fresh locks with PID values `0`, `-1`, `1.5`, and `Number.MAX_SAFE_INTEGER + 1`. Assert that each remains.
- [ ] Cover an old lock with no PID, an old lock with an unusable PID, and an old lock with `pid: process.pid` plus `checkPid: false`. Use `utimes()` and assert that each is removed.
- [ ] **Green:** Add a private predicate for `Number.isSafeInteger(pid) && pid > 0`.
- [ ] Call `isProcessAlive()` only for a usable PID. Route missing or unusable PIDs and `checkPid: false` to age-only cleanup.
- [ ] Preserve catch-all process-check behavior for usable PIDs.
- [ ] Keep Windows-side WSL behavior unchanged. Task 3 must remain red.

**Validation:**

- Run (red): `mise run compile && node --test --test-name-pattern='uses age-only cleanup when no usable local PID exists' dist/test/shared.test.js`
- Expected: At least the fresh fractional-PID case fails because current code passes it to Node PID checking and removes the lock.
- Run (green): `mise run compile && node --test --test-name-pattern='old local lock|age-only cleanup when no usable local PID exists' dist/test/shared.test.js`
- Expected: Both local discovery slices pass.

### Task 3: Preserve an old reachable Windows lock under WSL

**Seam:** `discoverIdeCandidates(options: DiscoverOptions): Promise<LockFileCandidate[]>`

**Outcome:** An old `runningInWindows: true` lock remains when its WSL-resolved host and port are reachable.

**Files:**

- Modify: `src/pi/discovery.ts`
- Test: `test/shared.test.ts`

**Steps:**

- [ ] **Red:** Add `keeps an old reachable Windows-side WSL lock` beside the existing WSL discovery tests.
- [ ] Reuse their real directory shape exactly: create a temporary root; set temporary `homeLockDir`; set `windowsUsersRoot` to `<root>/Users`; create the Windows lock directory at `<usersRoot>/julian/.pi/pi-x-ide/lock`; and write the lock there.
- [ ] Set `runningInWindows: true`, a deterministic non-running Linux PID, and an old mtime with `utimes()`.
- [ ] Call discovery with `cwd`, `homeLockDir`, `windowsUsersRoot`, `env: { WSL_DISTRO_NAME: "Ubuntu" }`, a fixed `resolveHost` that resolves `172.30.96.1`, and a fixed successful `tcpProbe` for that host and the named test port.
- [ ] Do not omit `env`. Without the WSL marker, the Windows-side branch does not execute and the test does not prove this requirement.
- [ ] Assert that discovery returns the Windows candidate path and preserves the file.
- [ ] **Green:** Move Windows-side WSL reachability before age-only deletion when `checkPid: true`.
- [ ] Preserve a reachable Windows lock at every age. Keep false or thrown probe removal behavior.
- [ ] Retain the current live-Linux-PID shortcut only in this slice. Task 4 must remain red.

**Validation:**

- Run (red): `mise run compile && node --test --test-name-pattern='keeps an old reachable Windows-side WSL lock' dist/test/shared.test.js`
- Expected: The test fails because current age cleanup removes the old lock before the WSL probe.
- Run (green): `mise run compile && node --test --test-name-pattern='keeps an old reachable Windows-side WSL lock|Windows-side WSL lock when Linux PID check fails|unreachable Windows-side WSL lock' dist/test/shared.test.js`
- Expected: Old and fresh reachable Windows locks remain. Unreachable Windows locks are removed.

### Task 4: Make the WSL TCP probe authoritative

**Seam:** `discoverIdeCandidates(options: DiscoverOptions): Promise<LockFileCandidate[]>`

**Outcome:** A Linux PID collision cannot preserve an unreachable Windows-side lock.

**Files:**

- Modify: `src/pi/discovery.ts`
- Test: `test/shared.test.ts`

**Steps:**

- [ ] **Red:** Add `removes an unreachable Windows-side WSL lock despite a Linux PID collision`.
- [ ] Use the same real WSL test shape as Task 3: temporary `homeLockDir`; `windowsUsersRoot` at `<root>/Users`; lock path `<usersRoot>/julian/.pi/pi-x-ide/lock/<name>.lock`; `env: { WSL_DISTRO_NAME: "Ubuntu" }`; and `runningInWindows: true`.
- [ ] Write a fresh lock with `pid: process.pid`. Pass the same fixed `resolveHost` and a fixed `tcpProbe` that returns `false` for the named port.
- [ ] Do not omit `env`. Without it, this is not a WSL-authority test.
- [ ] Assert that discovery returns no candidate and removes the Windows lock file.
- [ ] **Green:** Put the Windows-side WSL branch before all local PID logic when `checkPid: true`.
- [ ] Probe regardless of PID value or Linux PID liveness. Keep the lock only when TCP reachability is true.
- [ ] Preserve age-only behavior when `checkPid: false` and all local PID behavior from Tasks 1 and 2.

**Validation:**

- Run (red): `mise run compile && node --test --test-name-pattern='removes an unreachable Windows-side WSL lock despite a Linux PID collision' dist/test/shared.test.js`
- Expected: The test fails because current discovery trusts `process.pid` and skips the TCP probe.
- Run (green): `mise run compile && node --test --test-name-pattern='old local lock|age-only cleanup|Windows-side WSL lock' dist/test/shared.test.js`
- Expected: All local and WSL discovery slices pass.

### Task 5: Add periodic recovery and idle terminal stop

**Seam:** `startLockFileHeartbeat(refresh, options)` and public `LockFileHeartbeatHandle.refreshNow(): Promise<void>` plus `stop(): Promise<void>`

**Outcome:** A real periodic tick restores an externally deleted lock. An idle explicit request runs one refresh. Idle stop is terminal, prevents later work, and returns one promise object.

**Files:**

- Create: `src/shared/lock-file-heartbeat.ts`
- Create: `test/lock-file-heartbeat.test.ts`

**Steps:**

- [ ] **Red:** Create the test file with the required two-line `ABOUTME:` header. Add `restores an externally deleted lock until an idle heartbeat stops`.
- [ ] Use a real temporary `lockDir`, a named test port, `createIdeLockFilePath()`, `createIdeLockFile()`, `refreshIdeLockFile()`, and the real atomic writer.
- [ ] Pass the temporary `lockDir` as the explicit third argument to the initial and periodic `writeIdeLockFile(path, lock, lockDir)` calls. Never rely on `resolveLockDir()`.
- [ ] Start the heartbeat with a named short interval and real timers. Delete the lock. Use bounded polling until the same path exists.
- [ ] Assert unchanged identity fields and auth token, plus a changed `updatedAt`.
- [ ] While idle, delete the lock again and call `refreshNow()`. Await it and assert one successful immediate restoration through the same callback.
- [ ] When idle again, call `stop()` twice. Assert strict promise identity, then await it. Delete the lock, wait longer than two named intervals, and assert that it remains absent. Call `refreshNow()` after stop, assert that it returns the same terminal promise, await it, and assert that the lock remains absent.
- [ ] **Green:** Create `src/shared/lock-file-heartbeat.ts` with the required header. Export `LOCK_FILE_HEARTBEAT_INTERVAL_MS`, `LockFileHeartbeatOptions`, `LockFileHeartbeatHandle`, and `startLockFileHeartbeat(refresh, options?)`.
- [ ] Define `refresh` as `() => void | Promise<void>`. Define `LockFileHeartbeatOptions.intervalMs?: number` for programmatic tests; production callers omit it and use the exported 15-minute default.
- [ ] Define and return the complete public handle with `refreshNow(): Promise<void>` and `stop(): Promise<void>`. Implement these as methods that return stored promises directly, not `async` wrappers that create new promise objects.
- [ ] Use a real repeating Node timer, call `unref()`, and do not invoke `refresh` immediately.
- [ ] For this slice only, let idle `refreshNow()` invoke and return one successful refresh directly. After terminal state, return the stored terminal promise without invoking refresh. Do not implement busy-request queueing or error containment yet.
- [ ] On idle stop, synchronously clear the timer, mark terminal state, and store one resolved terminal promise for every stop call.
- [ ] Do not add shared queueing, callback containment, overlap prevention, or active drain. Tasks 6 and 7 must remain red.

**Validation:**

- Run (red): `mise run compile && node --test --test-name-pattern='restores an externally deleted lock until an idle heartbeat stops' dist/test/lock-file-heartbeat.test.js`
- Expected: Compilation fails because the shared heartbeat module does not exist.
- Run (green): `mise run compile && node --test --test-name-pattern='restores an externally deleted lock until an idle heartbeat stops' dist/test/lock-file-heartbeat.test.js`
- Expected: Timer and idle explicit refresh restore the lock. Idle stop and post-stop explicit calls return the same terminal promise, and no refresh runs after stop.

### Task 6: Serialize timer and explicit refresh requests

**Seam:** `startLockFileHeartbeat(refresh, options)` and public `LockFileHeartbeatHandle.refreshNow(): Promise<void>` plus `stop(): Promise<void>`

**Outcome:** Timer and explicit requests use one scheduler-owned serialized queue. Timer ticks skip while busy. Explicit requests are accepted in order. Refresh and `onError` failures are contained identically for both sources.

**Files:**

- Modify: `src/shared/lock-file-heartbeat.ts`
- Test: `test/lock-file-heartbeat.test.ts`

**Steps:**

- [ ] **Red:** Add `serializes explicit refreshes, skips busy ticks, and contains both request sources`.
- [ ] Use real timers and controllable promises. Call `refreshNow()` twice while the first explicit refresh is blocked. Keep it blocked across at least two timer intervals.
- [ ] Record start order, completion order, active count, maximum concurrency, refresh errors, and later successful calls.
- [ ] Make one explicit refresh reject with a fixed error. Make a later timer refresh reject with a second fixed error. Supply `onError` that records each exact error and deliberately throws a fixed handler error.
- [ ] Do not add a process-global `unhandledRejection` listener. Successful Node test completion must prove nested containment.
- [ ] Release explicit requests in order. Assert both explicit requests were accepted, maximum concurrency is `1`, busy timer ticks did not enqueue behind them, both request sources used the same error path, and a later idle timer tick still ran.
- [ ] Call `stop()` only after the scheduler is idle. Task 7 must still test active and queued drain.
- [ ] **Green:** Implement `refreshNow(): Promise<void>` and one scheduler-owned FIFO refresh queue. Add `LockFileHeartbeatOptions.onError?: (error: unknown) => void | Promise<void>`.
- [ ] Accept every explicit request before terminal stop. Return a promise that settles after that request callback and all error containment finish.
- [ ] At timer tick entry, skip the tick if any refresh is active or queued. Otherwise accept one timer refresh into the same queue.
- [ ] Execute at most one refresh callback at a time. Use one containment function for synchronous throws and rejected promises from either source.
- [ ] Call optional `onError(error)` inside a second containment boundary. Contain its synchronous throw or rejected promise. Always continue the queue.
- [ ] After terminal state, ignore `refreshNow()` and return the stored terminal promise without invoking refresh.
- [ ] Keep `unref()` and the fixed 15-minute production default.
- [ ] Retain Task 5's idle-only terminal stop behavior in this slice. If stop is called while requests are active or queued, it marks terminal and returns its stored resolved promise without waiting for that accepted work. This intentional missing drain makes Task 7 deterministically red.

**Validation:**

- Run (red): `mise run compile && node --test --test-name-pattern='serializes explicit refreshes, skips busy ticks, and contains both request sources' dist/test/lock-file-heartbeat.test.js`
- Expected: Assertions fail because Task 5 executes idle explicit refreshes directly and has no shared serialized queue, busy-request ordering, overlap prevention, or equal containment.
- Run (green): `mise run compile && node --test --test-name-pattern='idle heartbeat stops|serializes explicit refreshes, skips busy ticks, and contains both request sources' dist/test/lock-file-heartbeat.test.js`
- Expected: Both slices pass. Explicit requests run in order, busy ticks skip, maximum concurrency is one, both error sources are contained, and a later tick runs.

### Task 7: Drain every accepted refresh on terminal stop

**Seam:** `startLockFileHeartbeat(refresh, options)` and public `LockFileHeartbeatHandle.refreshNow(): Promise<void>` plus `stop(): Promise<void>`

**Outcome:** Stop rejects new work by ignoring it, waits for every accepted active and queued refresh plus containment, and returns the same terminal promise object forever.

**Files:**

- Modify: `src/shared/lock-file-heartbeat.ts`
- Test: `test/lock-file-heartbeat.test.ts`

**Steps:**

- [ ] **Red:** Add `drains the accepted explicit queue before one terminal stop promise resolves` after Task 6 is green.
- [ ] Use a real temporary `lockDir`, explicit third-argument writer calls, real timers, and three controllable explicit `refreshNow()` requests. Block the first; queue the second and third; and make the second exercise refresh plus `onError` containment failure.
- [ ] Delete the lock while the first request is active. Call `stop()` twice before releasing any request. Assert strict promise identity and assert that stop remains unsettled.
- [ ] Call `refreshNow()` after stop begins. Assert that it returns the same terminal promise and does not add an invocation.
- [ ] Release the first, second, and third accepted requests in order. Assert stop remains pending until the third request and its containment finish.
- [ ] Await stop. Remove the lock as producer cleanup. Wait longer than two named intervals. Assert no accepted or later request recreates it.
- [ ] This red runs after Task 6 green. It must fail because Task 6 stop does not wait for the complete accepted queue. Do not choose assertions that already pass after Task 6.
- [ ] **Green:** On the first `stop()`, synchronously set terminal state and clear the timer before reading queue state.
- [ ] Store one terminal drain promise immediately. Make it wait for the scheduler's complete accepted queue tail, including active callback, queued callbacks, refresh containment, and `onError` containment.
- [ ] Return that exact promise object from all stop calls, including calls after completion, and from ignored post-stop `refreshNow()` calls. Do not implement either method as an `async` wrapper because an async wrapper would return a different promise object.
- [ ] Do not cancel accepted callbacks. Do not run queued timer work because busy timer ticks were never accepted.

**Validation:**

- Run (red): `mise run compile && node --test --test-name-pattern='drains the accepted explicit queue before one terminal stop promise resolves' dist/test/lock-file-heartbeat.test.js`
- Expected: Stop settles before the second or third accepted request and containment complete.
- Run (green): `mise run compile && node --test dist/test/lock-file-heartbeat.test.js`
- Expected: All shared public-seam slices pass. Stop waits for the accepted queue, later requests are ignored, and every stop call returns one promise object.

### Task 8: Connect Neovim to the shared scheduler and ship the bundle

**Seam:** `startNvimSidecar(options)` and `NvimSidecarHandle.stop()`

**Outcome:** Neovim uses one shared handle for timer and workspace refresh, restores a deleted lock with latest workspace state, never touches the default lock directory when given a custom directory, and does not recreate the lock after awaited stop.

**Files:**

- Modify: `src/nvim/sidecar.ts`
- Test: `test/nvim-sidecar.test.ts`
- Regenerate: `ide-plugins/nvim/bin/pi-x-ide-nvim-sidecar.cjs`

**Steps:**

- [ ] **Red:** Add the required two-line header to `test/nvim-sidecar.test.ts`. Add `restores the sidecar lock with latest workspace only in its custom directory` as `test(name, { concurrency: false }, async () => ...)`.
- [ ] Run this test file as its own Node test-runner process. Keep tests in the file serial because this test temporarily changes `process.env.HOME`.
- [ ] Create separate `fakeHome` and temporary `lockDir` directories. Save the prior `process.env.HOME`. In a `try/finally`, set `process.env.HOME = fakeHome`, start the sidecar with the separate temporary `lockDir`, and restore or delete `HOME` exactly to its prior state in `finally`. Node `os.homedir()` reads `HOME` on each call.
- [ ] Use temporary streams and a named short `heartbeatIntervalMs`. Send a public `workspace_changed` message with new folders. Wait until the lock shows the latest folders.
- [ ] Delete `handle.lockFilePath`. Poll until the same path is recreated. Parse it and assert unchanged IDE, port, PID, auth token, and `createdAt`, plus the latest workspace folders.
- [ ] Before and after restoration, and again after stop, assert that `<fakeHome>/.pi/pi-x-ide/lock` does not exist. Current code deterministically creates or chmods that default directory because it omits the writer's explicit `lockDir` argument.
- [ ] Await `handle.stop()`. Assert the custom lock is absent. Wait longer than two named intervals and assert no recreation.
- [ ] Treat this as public-seam restore, latest-workspace, custom-directory, and stop no-recreation coverage. Do not claim that it independently proves scheduler queue internals or drain completeness; Tasks 6 and 7 prove those semantics.
- [ ] **Green:** Add `heartbeatIntervalMs?: number` to `NvimSidecarOptions` only as a programmatic seam. Do not add CLI parsing, help text, environment variables, or config.
- [ ] Resolve `const lockDir = options.lockDir ?? resolveLockDir()` once during startup. Retain it in runtime state.
- [ ] Pass that one directory to `createIdeLockFilePath()` and as the explicit third argument to both the initial and every refresh `writeIdeLockFile(path, lock, lockDir)` call.
- [ ] After the initial write succeeds, start one shared heartbeat handle. Its refresh callback derives and writes the lock from current sidecar workspace state.
- [ ] Route both `workspace_changed` and the existing accepted sidecar config update through one workspace-update function. First ignore the update when sidecar lifecycle state is stopped. Otherwise update current workspace state and await `heartbeat.refreshNow()`. Do not create a sidecar queue. Timer callbacks already enter the same scheduler through the handle.
- [ ] Route scheduler `onError` to the existing Neovim `stderr` message. Do not add a second catch path that reports the same failure twice.
- [ ] In `stop()`, atomically block sidecar lifecycle work, await `heartbeat.stop()`, remove the lock, then stop the server. Store and return one sidecar cleanup promise for idempotence.
- [ ] Run `mise run package:nvim-sidecar` as the last Green step. Commit the regenerated bundle with the source change.

**Validation:**

- Run (red): `mise run compile && node --test --test-name-pattern='restores the sidecar lock with latest workspace only in its custom directory' dist/test/nvim-sidecar.test.js`
- Expected: Compilation fails because `heartbeatIntervalMs` is absent, or the fake default directory assertion fails because current initial write resolves and touches the default directory.
- Run (green/source): `mise run compile && node --test --test-name-pattern='restores the sidecar lock with latest workspace only in its custom directory|starts sidecar' dist/test/nvim-sidecar.test.js`
- Expected: Both sidecar slices pass serially. The fake default lock directory never exists, the custom lock returns with latest workspace state, and awaited stop prevents recreation.
- Run (green/package): `mise run package:nvim-sidecar`
- Expected: `ide-plugins/nvim/bin/pi-x-ide-nvim-sidecar.cjs` is regenerated successfully and retains its two-line `ABOUTME:` header.
- Run (green/artifact): `grep -F 'refreshNow' ide-plugins/nvim/bin/pi-x-ide-nvim-sidecar.cjs`
- Expected: The committed shipped bundle contains the new shared-handle runtime. Validation does not stop at `dist/src/nvim/sidecar.js`.

### Task 9: Connect VS Code to the shared scheduler

**Seam:** VS Code `activate()` and `deactivate()` in `Run Pi x IDE VS Code Extension`

**Outcome:** Workspace-folder events call `refreshNow()`. The handle owns the timer and the only queue. Cleanup blocks lifecycle work, awaits terminal drain, and then removes the lock.

**Files:**

- Modify: `ide-plugins/vscode/src/extension.ts`

**Steps:**

- [ ] **Red, manual:** Before wiring, run the committed Extension Host, delete its lock, and keep it active for more than 15 minutes. Confirm that the lock remains absent.
- [ ] **Green:** Import the shared scheduler through the existing `@shared/*` alias. Store one heartbeat handle in extension lifecycle state.
- [ ] Start the handle only after the initial lock write succeeds. Use the exported 15-minute default. Its timer callback refreshes the current lock through the existing writer.
- [ ] Replace direct `onDidChangeWorkspaceFolders` refresh execution with `await heartbeat.refreshNow()` through existing callback safety. Do not create a VS Code queue.
- [ ] Keep lock-state calculation and writing inside the scheduler callback so timer and workspace requests cannot update `lockFile` concurrently.
- [ ] Route scheduler `onError` to `handleRefreshLockError()` exactly once for both timer and explicit event requests.
- [ ] Make cleanup idempotent with one stored cleanup promise. Concurrent calls from `deactivate()` and the registered disposable must return and await the same cleanup operation.
- [ ] In that cleanup operation, first mark lifecycle cleanup active and detach or clear the module handle so no producer callback can submit work through an active lifecycle reference. Capture the existing handle locally, await `handle.stop()`, then remove the lock and clear lock state.
- [ ] Preserve failed-activation cleanup. If failure occurs after handle creation, use the same idempotent stop-before-remove operation.
- [ ] Do not add a producer-owned queue, interval configuration, source-text test, or fake Extension Host.

**Validation:**

- Run (red/manual): Start `Run Pi x IDE VS Code Extension` from `.vscode/launch.json`.
- Expected: Before wiring, an externally deleted lock remains absent after more than 15 minutes.
- Run (green/compile): `mise run compile:vsix`
- Expected: VS Code type-check and bundle compilation pass with shared `refreshNow()` and awaited terminal cleanup.
- Run (green/manual): Start the Extension Host. Trigger workspace-folder changes around a heartbeat window. Delete the active lock and confirm restoration within approximately 15 minutes. Stop the Extension Host and confirm immediate removal and no return after another interval.
- Coverage limit: Compilation validates types and imports. The committed Extension Host launch validates lifecycle wiring. Automated queue and drain semantics come from Tasks 5-7; do not claim VS Code extension-host unit coverage.

### Task 10: Add the JetBrains Swing heartbeat lifecycle

**Seam:** `PiXIdeLockFileHeartbeat.start()` and synchronous `dispose()` composed with public `PiXIdeLockFileManager` methods

**Outcome:** A repeating 15-minute Swing heartbeat restores an externally deleted JetBrains lock. Synchronous terminal EDT disposal completes before cleanup and prevents later recreation.

**Files:**

- Create: `ide-plugins/jetbrains/src/main/kotlin/com/balaenis/pixide/lock/PiXIdeLockFileHeartbeat.kt`
- Create: `ide-plugins/jetbrains/src/test/kotlin/com/balaenis/pixide/lock/PiXIdeLockFileHeartbeatTest.kt`

**Steps:**

- [ ] **Red:** Create the test file with the required two-line `ABOUTME:` header. Add `restoresDeletedLockUntilSynchronouslyDisposed`.
- [ ] Use a real temporary directory and a real `PiXIdeLockFileManager` with fixed PID and clock inputs. Write, retain lock identity, and delete `currentPath`.
- [ ] Construct the heartbeat with a named short interval and a synchronous callback to `manager.refresh(workspaceFolders)`. Start it.
- [ ] Use bounded polling or a latch to observe recreation. Assert the same path, port, PID, auth token, `createdAt`, and workspace folders.
- [ ] Call `dispose()`, then `manager.cleanup()`. Attempt `start()` again. Wait longer than two named intervals and assert that the lock remains absent.
- [ ] **Green:** Create the heartbeat file with the required header and a named 15-minute production constant.
- [ ] Use a repeating `javax.swing.Timer`. Do not invoke its callback immediately.
- [ ] Run start, callback, and stop state transitions on the EDT. Marshal off-EDT `dispose()` synchronously to the EDT. Stop directly on the EDT.
- [ ] Make `start()` idempotent while active. Make `dispose()` idempotent and terminal. Guard direct and queued starts after disposal.
- [ ] Keep callback failure containment at the service callback boundary so one failure does not stop the repeating timer.
- [ ] Keep the helper independent of `Project`, logging, workspace lookup, and lock contents.

**Validation:**

- Run (red): `mise run compile:jetbrains -- --tests com.balaenis.pixide.lock.PiXIdeLockFileHeartbeatTest.restoresDeletedLockUntilSynchronouslyDisposed`
- Expected: Kotlin test compilation fails because `PiXIdeLockFileHeartbeat` does not exist.
- Run (green): `mise run compile:jetbrains -- --tests com.balaenis.pixide.lock.PiXIdeLockFileHeartbeatTest`
- Expected: The heartbeat restores the lock. Synchronous terminal disposal followed by cleanup is not undone.

### Task 11: Wire the JetBrains heartbeat to project lifecycle

**Seam:** `PiXIdeProjectService.start()` and `dispose()` in an IntelliJ `runIde` sandbox

**Outcome:** A started project owns one heartbeat. Failed start and project disposal synchronously stop it on the EDT before lock cleanup.

**Files:**

- Modify: `ide-plugins/jetbrains/src/main/kotlin/com/balaenis/pixide/PiXIdeProjectService.kt`

**Steps:**

- [ ] **Red, manual:** Before wiring, run the sandbox, open a project, delete its lock, and keep the project open for more than 15 minutes. Confirm that it remains absent.
- [ ] **Green:** Add one owned nullable `PiXIdeLockFileHeartbeat` field.
- [ ] After `lockFileManager.write()` succeeds, construct and start the heartbeat with the production default. Its synchronous callback calls the existing `refreshWorkspaceFolders()` method.
- [ ] Keep root-change and heartbeat refreshes on the EDT. JetBrains message callbacks and Swing timer callbacks are serialized there.
- [ ] In `dispose()`, stop the editor tracker first, synchronously dispose and clear the heartbeat, then call `lockFileManager.cleanup()`, then stop the server.
- [ ] Apply the same heartbeat-dispose-before-lock-cleanup order in the `start()` catch block.
- [ ] Keep refresh failures on the existing `refreshWorkspaceFolders()` logging path.
- [ ] Do not add constructor injection, a fake `Project`, a source-text test, a promise stop, or a project-service harness.

**Validation:**

- Run (red/manual): `cd ide-plugins/jetbrains && ./gradlew runIde`
- Expected: Before wiring, an externally deleted project lock remains absent after more than 15 minutes.
- Run (green/compile): `mise run compile:jetbrains -- --tests com.balaenis.pixide.lock.PiXIdeLockFileHeartbeatTest --tests com.balaenis.pixide.lock.PiXIdeLockFileManagerTest`
- Expected: Production compilation succeeds. Heartbeat and lock-manager tests pass.
- Run (green/manual): `cd ide-plugins/jetbrains && ./gradlew runIde`
- Expected: The lock returns within approximately 15 minutes while the project is open. Closing the project removes it, and synchronous EDT disposal prevents later recreation.

### Task 12: Define the normative lock lifecycle

**Seam:** Published lifecycle text in `docs/specs/ide-protocol.md`

**Outcome:** The protocol specifies corrected consumer liveness and producer heartbeat behavior without a version or schema change.

**Files:**

- Modify: `docs/specs/ide-protocol.md`

**Steps:**

- [ ] **Red, document review:** Confirm that the current rules treat stale age as unconditional and do not define producer refresh or terminal cleanup.
- [ ] **Green:** State that a consumer must not remove a lock only because of age after it proves the producer is live.
- [ ] Define a usable local PID as a positive safe integer. State live, dead, missing, unusable, and `checkPid: false` outcomes.
- [ ] State that WSL TCP reachability is authoritative for `runningInWindows: true` locks.
- [ ] State that repository lock producers for VS Code, Neovim, and JetBrains refresh owned locks every 15 minutes while active. Refresh preserves endpoint identity and auth token, updates freshness data, and can recreate an externally deleted owned lock.
- [ ] State that TypeScript producers drain every accepted refresh before removal. State that JetBrains synchronously stops its EDT timer before cleanup.
- [ ] Do not change the JSON example, protocol version, token fields, or schema semantics.

**Validation:**

- Run (red/document review): Review `docs/specs/ide-protocol.md` before editing.
- Expected: Required liveness precedence, heartbeat, and cleanup ordering are absent.
- Run (green): `mise run format:check`
- Expected: Formatting passes and all normative lifecycle statements are present without a protocol version change.

### Task 13: Explain discovery and heartbeat mechanisms

**Seam:** Mirrored lifecycle sections in the English and Chinese discovery explanations

**Outcome:** Explanation documentation describes why liveness overrides age and how fixed producer heartbeats maintain discoverability.

**Files:**

- Modify: `docs/explanation/discovery.md`
- Modify: `docs/zh-CN/explanation/discovery.md`

**Steps:**

- [ ] **Red, document review:** Confirm that both files currently say every file older than 24 hours is deleted.
- [ ] **Green:** In concise ASD-STE100 English, explain that Pi first uses authoritative liveness when available. Explain live PID, dead PID, missing or unusable PID, `checkPid: false`, and authoritative WSL TCP behavior.
- [ ] Explain that VS Code, Neovim, and JetBrains refresh owned locks every 15 minutes. Explain that external deletion can remain visible until the next heartbeat.
- [ ] Apply the same meaning to `docs/zh-CN/explanation/discovery.md`. Keep mirrored links correct.
- [ ] Keep this task explanation-oriented. Do not add cleanup commands, test intervals, `utimes()`, polling, or test mechanics.
- [ ] Preserve Zed's SQLite distinction.

**Validation:**

- Run (red/document review): Review both discovery explanation files before editing.
- Expected: Both contain the unconditional 24-hour deletion statement.
- Run (green): `mise run format:check`
- Expected: Both files are semantically synchronized and explain liveness precedence plus the fixed heartbeat without operational troubleshooting steps.

### Task 14: Correct stale-lock troubleshooting guidance

**Seam:** Mirrored stale-lock sections in the English and Chinese troubleshooting guides

**Outcome:** Users receive correct recovery actions without the false claim that Pi always removes files older than 24 hours.

**Files:**

- Modify: `docs/how-to/troubleshoot-connection.md`
- Modify: `docs/zh-CN/how-to/troubleshoot-connection.md`

**Steps:**

- [ ] **Red, document review:** Confirm that both stale-lock sections say Pi normally reclaims files older than 24 hours or with a dead PID.
- [ ] **Green:** Replace the unconditional age statement. Explain that Pi preserves a lock when authoritative PID or WSL TCP liveness succeeds, and uses age-only cleanup only when authoritative liveness is unavailable or disabled.
- [ ] Tell users that an active VS Code, Neovim, or JetBrains producer normally recreates an externally deleted lock on its next 15-minute heartbeat.
- [ ] Keep the existing safe operational sequence: confirm the IDE is stopped before manual deletion, reload or restart the producer, then run `/ide auto`.
- [ ] Keep the WSL warning. Do not tell users to delete a Windows-side lock while its IDE is still running.
- [ ] Mirror meaning and relative links in the Chinese file. Keep this task action-oriented and link to the explanation page for mechanism details.

**Validation:**

- Run (red/document review): Review both troubleshooting files before editing.
- Expected: Both contain the false unconditional age statement.
- Run (green): `mise run format:check`
- Expected: Both files are synchronized, action-oriented, and no longer claim that every lock older than 24 hours is reclaimed.

## Final Validation

Run after all slices are green:

- Run: `mise run format:check`
- Expected: Prettier reports no formatting differences.
- Run: `mise run lint`
- Expected: ESLint reports no errors.
- Run: `mise run typecheck`
- Expected: Root TypeScript and VS Code type-check without errors.
- Run: `mise run test`
- Expected: All root tests pass, including discovery, shared scheduler queue/drain, and serial Neovim public-lifecycle coverage.
- Run: `mise run compile:vsix`
- Expected: The VS Code extension type-checks and bundles with the shared scheduler lifecycle.
- Run: `mise run compile:jetbrains`
- Expected: All JetBrains tests pass, including heartbeat and lock-manager coverage.
- Run: `mise run compile:all`
- Expected: Root TypeScript, VS Code, and JetBrains compilation paths pass together.
- Run: `mise run package:nvim-sidecar`
- Expected: The committed Neovim bundle is regenerated from the final source.
- Run: `grep -F 'refreshNow' ide-plugins/nvim/bin/pi-x-ide-nvim-sidecar.cjs`
- Expected: The shipped bundle contains the shared scheduler runtime and retains the generated two-line `ABOUTME:` header.
- Run: `mise run build`
- Expected: The aggregate build passes, including root compile, VS Code compile, and Neovim sidecar packaging. The final artifact is not validated only through `dist` source.
- Run: `mise run verify:jetbrains`
- Expected: IntelliJ plugin verification succeeds for configured IDE builds.

Manual validation:

- Use `.vscode/launch.json` and `Run Pi x IDE VS Code Extension`. Trigger a workspace-folder refresh, delete the lock, confirm restoration within approximately 15 minutes, stop the Extension Host, and confirm removal with no later recreation.
- Run `cd ide-plugins/jetbrains && ./gradlew runIde`. Trigger a project-root refresh, delete the lock, confirm restoration within approximately 15 minutes, close the project, and confirm removal with no later recreation.
- For automated age tests, use `utimes()` rather than a 24-hour wait.
- For automated heartbeat tests, use named short intervals, controllable promises, bounded polling, and real timers. Do not use fake timers.
- Inspect every test call to `writeIdeLockFile()`. Each must pass its real temporary `lockDir` as the third argument.
- Inspect Task 3 and Task 4 WSL tests. Each must use temporary `homeLockDir`, `<usersRoot>/julian/.pi/pi-x-ide/lock`, explicit WSL env, `runningInWindows: true`, fixed host resolution, and fixed TCP probing.
- Inspect TypeScript producers. Neovim and VS Code must have no producer-owned refresh queue. Workspace events must call the same shared handle whose internal timer enters the scheduler queue.
- Inspect TypeScript cleanup order: block lifecycle requests, await the shared handle's terminal `stop()`, then remove the lock.
- Inspect the Neovim test. It must restore `HOME` in `finally`, run with `concurrency: false`, and prove that the fake default lock directory never exists.
- Inspect the final diff. Confirm that `src/shared/lock-file.ts`, configuration registries, schema, protocol version, token logic, PID identity logic, Zed code, and unrelated files did not change.
- Inspect all new and modified code/test files for the required two-line `ABOUTME:` header.

## Failure Behavior

- A malformed lock remains removable during discovery.
- A usable local PID that makes `process.kill(pid, 0)` throw is dead. Pi removes its lock at any age.
- A missing or unusable PID uses age-only cleanup. A fresh lock remains. An old lock is removed.
- `checkPid: false` always uses age-only cleanup, including WSL Windows-side locks.
- A WSL Windows-side TCP probe that returns `false` or throws is authoritative evidence of an unreachable producer. Pi removes the lock.
- A timer tick received while any refresh is active or queued is skipped. It is not added to the queue.
- Every explicit `refreshNow()` received before terminal stop is accepted in FIFO order, even when another refresh is active or queued.
- Timer and explicit refresh failures use the same containment. `onError` receives each refresh failure. A throwing or rejecting `onError` is also contained. Later accepted work continues.
- The first `stop()` is terminal. It clears the timer, ignores later explicit requests, waits for all accepted active and queued work plus containment, and returns one stored promise object from every call.
- Neovim and VS Code do not own another queue. Their workspace events enter the shared scheduler through `refreshNow()`.
- Concurrent VS Code cleanup calls share one cleanup promise. No second cleanup can remove the lock before the first call drains the scheduler.
- Neovim writes scheduler errors to its existing `stderr` path. The sidecar and WebSocket server continue.
- VS Code uses `handleRefreshLockError()`. The extension and WebSocket server continue.
- JetBrains refresh callbacks are synchronous and EDT-serialized. Synchronous EDT timer disposal completes after any active callback and before lock cleanup.
- Initial lock-write failure does not start a heartbeat. Failed startup uses stop/dispose-before-cleanup if heartbeat creation already occurred.

## Privacy and Security

- Heartbeats rewrite only the producer's current owned lock.
- Refresh preserves the existing auth token. It must not generate, rotate, print, or expose the token.
- Terminal drain prevents a late accepted callback from recreating endpoint and auth data after producer shutdown.
- Keep existing atomic writes and best-effort `0700` directory and `0600` file permissions.
- Validate PID before `process.kill()` to prevent zero or negative process-group checks and invalid numeric calls.
- The WSL branch probes only the host and port from existing resolver and probe boundaries. Do not add network scanning.
- All shared-writer tests use synthetic tokens and real temporary directories. Every writer call receives the temporary `lockDir`; tests must not create, chmod, rename, or remove files under the developer's real `~/.pi` tree.
- The Neovim HOME-guard test uses a fake home only to detect accidental default-directory access. It restores the prior process environment in `finally` and runs serially.
- No new telemetry, external write, secret, or network destination is introduced.

## Rollout Notes

- Ship Pi discovery and the VS Code, Neovim, and JetBrains producer heartbeats in one release.
- Ship the regenerated `ide-plugins/nvim/bin/pi-x-ide-nvim-sidecar.cjs`; source-only changes are insufficient for installed Neovim users.
- No migration, user action, schema regeneration, configuration change, or protocol negotiation is necessary.
- VS Code, Neovim, and JetBrains refresh every 15 minutes while active. This is 96 local atomic rewrites per active producer per day.
- External deletion can remain visible until the next heartbeat, approximately 15 minutes under normal scheduling.
- TypeScript shutdown can wait indefinitely for accepted refresh work. This preserves cleanup correctness because refresh cancellation is outside scope.
- Existing sessions receive new behavior only after the updated Pi package, VS Code extension, Neovim sidecar bundle, or JetBrains plugin starts.
- Zed deployment does not change because Zed discovery reads SQLite.

## Risks and Mitigations

- **PID reuse can preserve a dead local lock.** Keep this known limitation. Do not add PID identity or start-time tracking.
- **A WSL network failure can remove a valid Windows lock.** Keep authoritative probe semantics. An active producer can recreate its lock on a later heartbeat.
- **A Linux PID can equal a Windows IDE PID.** Ignore Linux PID liveness for Windows-side WSL locks.
- **A timer can keep a Node process alive.** Call `unref()` on the shared timer.
- **Timer and producer event refreshes can overlap or reorder.** Make the shared scheduler the only queue owner. Route workspace events through `refreshNow()` and skip busy timer ticks.
- **A callback or error handler failure can escape or break the queue.** Use one nested containment path for timer and explicit requests. Verify later work through the public seam.
- **Cleanup can race with accepted queued refreshes.** Make stop terminal before observing the queue tail. Drain active and queued work plus containment before producer removal.
- **A never-settling accepted refresh can delay shutdown indefinitely.** Preserve correctness by waiting. Do not add cancellation or timeout semantics without a separate requirement.
- **Short real-timer tests can be flaky.** Use named intervals, controllable promises, bounded polling, `finally` cleanup, and negative waits longer than two intervals. Do not use fake timers.
- **A test can accidentally touch real `~/.pi`.** Pass temporary `lockDir` explicitly. Use the serial fake-HOME Neovim guard to make default-directory access deterministic.
- **A WSL test can silently execute the local branch.** Always pass `env: { WSL_DISTRO_NAME: "Ubuntu" }` with the real Windows user directory shape and fixed probe boundaries.
- **The committed Neovim bundle can drift from source.** Regenerate it in the Neovim Green step, inspect it for `refreshNow`, and run the aggregate build.
- **Swing timer operations can occur off the EDT.** Marshal start and disposal to the EDT. Make disposal synchronous before cleanup.
- **VS Code wiring has limited automated coverage.** Use the shared scheduler tests, `mise run compile:vsix`, and the committed Extension Host launch. Do not claim extension-host unit coverage.
- **JetBrains service wiring has limited automated coverage.** Use the tested heartbeat seam, JetBrains compilation, and `runIde`. Do not add source-text assertions.
- **Documentation can drift between languages or Diátaxis types.** Update each English/Chinese pair in one task. Keep explanation mechanism-oriented and troubleshooting action-oriented.

## Open Questions

**Open Questions:** None.
