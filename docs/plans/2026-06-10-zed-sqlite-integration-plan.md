# Zed SQLite Integration Implementation Plan

**Goal:** Add automatic Zed editor context support to pi-x-ide by reading Zed's local SQLite state database when Pi is running inside a Zed terminal.

**Inputs:** User request to implement Zed text interaction support, `docs/zed-integration-analysis.md`, OpenCode Zed SQLite investigation, and repository evidence from `src/pi/index.ts`, `src/pi/state.ts`, `src/shared/paths.ts`, `src/shared/format.ts`, `test/shared.test.ts`, and `package.json`.

**Assumptions:**

- Pi's extension runtime uses Node.js 22.5+ or newer; the current development environment confirms `node:sqlite` exposes `DatabaseSync`, so the implementation will use Node core SQLite instead of adding `better-sqlite3`.
- Zed stable stores state at `~/.local/share/zed/db/0-stable/db.sqlite` on Linux and `~/Library/Application Support/Zed/db/0-stable/db.sqlite` on macOS, with an override env var named `PI_X_IDE_ZED_DB`.
- Zed SQLite support is a fallback path: existing WebSocket/lock-file IDE connections remain preferred when available.

**Architecture:** Add a focused `src/pi/zed.ts` module that detects Zed terminals, resolves the Zed SQLite DB path, queries active editor/selection state, converts UTF-8 byte offsets to protocol positions, and polls for changes. Wire it into `src/pi/index.ts` as a fallback after WebSocket auto-connect fails, reusing the existing `EditorSelectionSnapshot`, `setLatestSelection`, `clearLatestSelection`, UI widget, and prompt-context injection paths.

**Tech Stack:** TypeScript, Node.js `node:sqlite` (`DatabaseSync`), Node built-in `node:test`, existing pi-x-ide runtime/state/context modules.

---

## File Map

- Create: `src/pi/zed.ts` — Zed terminal detection, DB path resolution, SQLite queries, UTF-8 byte-offset conversion, snapshot creation, and polling lifecycle helpers.
- Modify: `src/pi/state.ts` — Add Zed polling timer/key fields to `PiIdeRuntime`.
- Modify: `src/pi/index.ts` — Start Zed polling after failed WebSocket auto-connect, stop it when WebSocket connects/disconnects/session shuts down, and keep UI state coherent.
- Modify: `package.json` — Add the `zed` keyword and, only if TypeScript requires newer Node declarations, update `@types/node` to the latest stable version.
- Modify: `README.md` — Document automatic Zed support, environment detection, and `PI_X_IDE_ZED_DB`.
- Modify: `README.zh.md` — Add matching Chinese documentation for Zed support.
- Test: `test/zed.test.ts` — Cover Zed DB path/env detection, workspace matching, active editor lookup, UTF-8 byte offsets, multi-selection behavior, empty selections, terminal/non-editor exclusion, and disk-file fallback.

## Tasks

### Task 1: Add the Pure Zed SQLite Resolver

**Outcome:** `src/pi/zed.ts` can read a Zed SQLite DB file and return an `EditorSelectionSnapshot` with `source: "zed"`, a matched workspace folder, the active file path, and non-empty selected ranges when Zed has selected text.

**Files:**

- Create: `src/pi/zed.ts`
- Test: `test/zed.test.ts`

**Steps:**

- [ ] Create `src/pi/zed.ts` and export `PI_X_IDE_ZED_DB_ENV = "PI_X_IDE_ZED_DB"` and `ZED_POLL_INTERVAL_MS = 1000`.
- [ ] Implement `isZedTerminal(env: NodeJS.ProcessEnv = process.env): boolean` returning true when `env.ZED_TERM === "true"` or `env.TERM_PROGRAM?.toLowerCase() === "zed"`.
- [ ] Implement `resolveZedDbPath(env = process.env, home = homedir()): string | undefined` that checks `PI_X_IDE_ZED_DB`, then macOS and Linux stable DB paths, and returns the first existing file.
- [ ] Implement `parseZedWorkspacePaths(value: string | null): string[]` accepting JSON string arrays and newline-delimited paths; return an empty array for malformed JSON or empty values.
- [ ] Implement `resolveZedSelection(options: { dbPath: string; cwd: string; now?: number; readFile?: (path: string) => string }): EditorSelectionSnapshot | undefined` using `node:sqlite` `DatabaseSync`.
- [ ] Query active Zed editor with the SQL from `docs/zed-integration-analysis.md`, skip rows where `item_kind !== "Editor"` or `editor_id`/`buffer_path` is missing, score rows by `isPathInsideOrEqual(workspacePath, cwd)`, and choose the highest score then latest timestamp.
- [ ] Query selections from `editor_selections` by `editor_id` and `workspace_id`; normalize reversed ranges with `Math.min(start, end)` and `Math.max(start, end)`.
- [ ] Query editor contents from `editors.contents`; if empty or not a string, call the injected `readFile` or `readFileSync(buffer_path, "utf8")`.
- [ ] Convert UTF-8 byte offsets to JavaScript string indexes with `TextEncoder`, preserving surrogate pairs for emoji.
- [ ] Convert string indexes to protocol positions with 0-based `{ line, character }`, matching existing VS Code protocol conventions.
- [ ] Build `ranges` only for non-empty selections; if all selections are empty caret positions, return the active file snapshot with `ranges: []`.
- [ ] Add `test/zed.test.ts` using `node:test`, `node:assert/strict`, `mkdtemp`, and `node:sqlite` `DatabaseSync` to create an on-disk temp DB fixture.
- [ ] Add tests for: `isZedTerminal`, `resolveZedDbPath` env override, JSON/newline workspace parsing, best workspace match, active editor snapshot, UTF-8 text selection containing Chinese and emoji, reversed selection normalization, empty selection returning `ranges: []`, active Terminal returning `undefined`, and file-system fallback when `editors.contents` is empty.

**Validation:**

- Run: `pnpm build && node --test dist/test/zed.test.js`
- Expected: TypeScript compiles and all tests in `dist/test/zed.test.js` pass.

### Task 2: Wire Zed Polling Into Runtime State

**Outcome:** When Pi runs inside Zed and no WebSocket IDE connection is available, pi-x-ide polls the Zed DB every second and updates the existing latest-selection state and UI.

**Files:**

- Modify: `src/pi/state.ts`
- Modify: `src/pi/index.ts`
- Modify: `src/pi/zed.ts`
- Test: `test/zed.test.ts`

**Steps:**

- [ ] Add `zedPollTimer?: NodeJS.Timeout` and `zedPollSelectionKey?: string` to `PiIdeRuntime` in `src/pi/state.ts`.
- [ ] In `src/pi/zed.ts`, implement `stopZedPolling(runtime: PiIdeRuntime): void` that clears `runtime.zedPollTimer`, resets `runtime.zedPollSelectionKey`, and leaves `latestSelection` untouched unless the caller decides to clear it.
- [ ] In `src/pi/zed.ts`, implement `startZedPolling(runtime: PiIdeRuntime, ctx: ExtensionContext | ExtensionCommandContext, options?: { dbPath?: string; intervalMs?: number; generation?: number }): boolean`.
- [ ] Make `startZedPolling` return `false` without side effects when `isZedTerminal()` is false or `resolveZedDbPath()` returns undefined.
- [ ] When polling starts, set `runtime.connectionStatus = "connected"`, `runtime.connectedServer = { name: "Zed", ide: "zed" }`, `runtime.connectionMessage = undefined`, and call `updateIdeUi(runtime, ctx)`.
- [ ] On each poll tick, call `resolveZedSelection({ dbPath, cwd: ctx.cwd })`; when it returns a snapshot with a changed `snapshotKey`, call `setLatestSelection(runtime, snapshot, ctx)`; when it returns `undefined`, call `clearLatestSelection(runtime, ctx)` while keeping Zed connection status connected.
- [ ] Guard each poll tick with the supplied `generation` so stale timers from older sessions do not update runtime state.
- [ ] In `src/pi/index.ts`, import `startZedPolling` and `stopZedPolling`.
- [ ] In `session_start`, call `stopZedPolling(runtime)` before starting a new connect attempt, then after `await connectAuto(runtime, ctx)`, call `startZedPolling(runtime, ctx, { generation })` only if `runtime.connectionStatus !== "connected"`.
- [ ] In `connectCandidate`, call `stopZedPolling(runtime)` before replacing the current connection so WebSocket remains the preferred source.
- [ ] In `disconnect`, call `stopZedPolling(runtime)`; when `disabled` is true, preserve the existing selection-clearing behavior.
- [ ] In `session_shutdown`, call `stopZedPolling(runtime)` before disconnecting WebSocket and clearing UI.
- [ ] Add tests in `test/zed.test.ts` for `stopZedPolling` clearing a timer and `startZedPolling` returning `false` when the env does not identify Zed or the DB path is missing.

**Validation:**

- Run: `pnpm build && node --test dist/test/zed.test.js dist/test/shared.test.js`
- Expected: Zed-specific tests pass and existing shared behavior still passes.

### Task 3: Preserve WebSocket Priority and Existing IDE Commands

**Outcome:** Existing VS Code/Cursor/Windsurf WebSocket behavior remains unchanged, and Zed fallback does not interfere with `/ide auto`, `/ide off`, `/ide attach`, or reconnect handling.

**Files:**

- Modify: `src/pi/index.ts`
- Modify: `src/pi/zed.ts`
- Test: `test/shared.test.ts`
- Test: `test/install.test.ts`

**Steps:**

- [ ] Ensure `connectAuto` still refreshes lock-file candidates and connects matching WebSocket candidates before Zed polling is considered.
- [ ] Ensure `scheduleReconnect` keeps current WebSocket semantics; after a failed auto reconnect, allow the same post-`connectAuto` Zed fallback path used by `session_start` to run when still disconnected.
- [ ] Ensure `/ide off` stops both WebSocket and Zed polling by routing through the existing `disconnect(runtime, ctx, true)` path.
- [ ] Ensure `/ide attach` works unchanged: it reads `runtime.latestSelection`, which can now come from WebSocket or Zed SQLite polling.
- [ ] Add one assertion to an existing command/state test, or a new focused test, proving that `createRuntime()` initializes with no Zed timer/key and that stopping polling is idempotent.

**Validation:**

- Run: `pnpm build && node --test dist/test/*.test.js`
- Expected: All compiled tests pass, including existing install command wiring and lock-file discovery tests.

### Task 4: Document User-Facing Zed Support

**Outcome:** Users understand that Zed support is automatic when Pi runs inside a Zed terminal, requires no Zed extension, and can be configured with `PI_X_IDE_ZED_DB` if the DB path differs.

**Files:**

- Modify: `README.md`
- Modify: `README.zh.md`
- Modify: `package.json`

**Steps:**

- [ ] In `README.md`, add a Zed section near existing IDE integration instructions stating: run Pi from Zed's integrated terminal; pi-x-ide detects `ZED_TERM=true` or `TERM_PROGRAM=zed`; selection context is read from Zed's local SQLite DB; no Zed extension install is required.
- [ ] Document `PI_X_IDE_ZED_DB` in `README.md` with Linux and macOS default paths.
- [ ] Add the matching Chinese section to `README.zh.md`, keeping English/code terms spaced correctly from Chinese text.
- [ ] Add `zed` to the `keywords` array in `package.json`.
- [ ] Do not change `/ide install` copy in this task unless implementation added Zed-specific install behavior; SQLite support has no install step.

**Validation:**

- Run: `pnpm format:check`
- Expected: Prettier reports all files are formatted.

### Task 5: Run Full Validation and Fix Regressions

**Outcome:** The implementation passes the project's existing build, typecheck, tests, lint, and formatting checks.

**Files:**

- Modify: Any file touched by fixes found during validation.

**Steps:**

- [ ] Run type checking after all code changes.
- [ ] Run the full test suite.
- [ ] Run lint.
- [ ] Run formatting check.
- [ ] If any command fails, fix the reported file and rerun the failing command before continuing.

**Validation:**

- Run: `pnpm typecheck && pnpm test && pnpm lint && pnpm format:check`
- Expected: All commands exit 0.

## Final Validation

- Run: `pnpm typecheck && pnpm test && pnpm lint && pnpm format:check`
- Expected: TypeScript compile checks pass for root and VS Code package, all `node:test` tests pass, ESLint reports no errors, and Prettier reports all files are formatted.

## Rollout Notes

- Zed support activates only when Pi is launched inside a Zed terminal detected by `ZED_TERM=true` or `TERM_PROGRAM=zed`; users launching Pi outside Zed continue to use existing WebSocket lock-file integration.
- Users with custom Zed data directories can set `PI_X_IDE_ZED_DB=/absolute/path/to/db.sqlite`.
- No Zed extension or Marketplace publication is required for the recommended SQLite path.
- If `node:sqlite` is unavailable in a supported Pi runtime, switch the implementation to the latest stable `better-sqlite3` and update `package.json`, `pnpm-lock.yaml`, and README installation notes in the same change.

## Risks and Mitigations

- Zed SQLite schema changes in a future release — Keep queries isolated in `src/pi/zed.ts`; catch query failures and return `undefined` so pi-x-ide falls back to no editor context instead of crashing.
- Polling reads stale data for up to one second — Use the 1000 ms interval from OpenCode's proven approach; this is acceptable because context is consumed when the user submits a message.
- Multiple Pi sessions read the same Zed DB — Reads are safe with SQLite; each process keeps its own in-memory selection state.
- Workspace mismatch could leak context from another Zed window — Score only workspaces that contain `ctx.cwd` using existing path helpers, and ignore rows with no matching workspace path.
- UTF-8 byte offsets can split multi-byte characters — Convert byte offsets by iterating code points with `TextEncoder`, and cover Chinese and emoji selections in `test/zed.test.ts`.
