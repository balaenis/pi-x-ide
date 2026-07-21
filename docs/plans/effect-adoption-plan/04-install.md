# Phase 4: Install Workflow

**Goal:** Run IDE extension discovery and install command execution as Effect programs behind stable Promise/result APIs.

**Inputs:** [Overview](./00-overview.md); `src/pi/install.ts`; `test/install.test.ts`; auto-install call sites in `src/pi/index.ts`.

**Assumptions:**

- Phase 1 merged (`InstallCommandError`, `runEffect`).
- Public shapes stay: `IdeInstallCandidate`, `IdeInstallResult`, `discoverInstallCandidates()`, `installIdeExtension()`, `isAutoInstallEnabled()`.
- Supported CLIs remain `code` / `cursor` / `windsurf` only.
- Default auto-install remains enabled unless env/config disables it.

**Architecture:** Pure helpers stay pure. Shelling out becomes Effect (or Promise wrapped in `Effect.tryPromise`). Facades used by `index.ts` keep `async` signatures. Do not redesign install UX strings in `index.ts` except if error message source moves to tagged error `.stderr`.

**Tech Stack:** Effect, `node:child_process` via existing `execFile` promisify, `resolvePiConfigEnv`.

**Depends on:** Phase 1.

**Out of scope:** JetBrains/nvim install paths; marketplace publishing; connection retry logic (stays in `index.ts` / Phase 5–6).

---

## File Map

- Modify: `src/pi/install.ts`
- Modify: `test/install.test.ts`
- Verify only: `src/pi/index.ts` (call sites)

---

## Tasks

### Task 4.1: Pure helpers audit

**Outcome:** Version parse/compare and env flags remain plain TS with full test coverage.

**Files:**

- Modify: `src/pi/install.ts` (no forced change)
- Test: `test/install.test.ts`

**Steps:**

- [ ] Keep as plain functions:
  - `isAutoInstallEnabled`
  - `parseInstalledExtensionVersion`
  - `compareExtensionVersions`
  - `selectAutoInstallCandidate` (if present)
  - `SUPPORTED_IDE_CLI_PROFILES`
- [ ] Add tests only where gaps exist (older/newer/unknown versions, env `0`/`false`/`off`).

**Validation:**

- Run: `mise run test`
- Expected: install pure-helper tests pass.

### Task 4.2: Discover install candidates Effect

**Outcome:** CLI detection + `--list-extensions` composition is Effect-based; result array shape unchanged.

**Files:**

- Modify: `src/pi/install.ts`
- Test: `test/install.test.ts`

**Steps:**

- [ ] Implement `discoverInstallCandidatesEffect(options): Effect.Effect<IdeInstallCandidate[], never, never>` (or explicit error if you choose fail-soft per CLI — match current: collect what you can).
- [ ] Preserve confidence ordering: `current-terminal` > `running-process` > `available-cli` (verify against current code).
- [ ] Preserve `needsInstall` / `reason` derivation from version compare + list errors.
- [ ] Facade: `export async function discoverInstallCandidates(...): Promise<IdeInstallCandidate[]>`.
- [ ] Timeouts: keep existing `timeoutMs` defaults.

**Validation:**

- Run: `mise run test`
- Expected: discovery candidate tests pass (inject stubs if tests already mock exec).

### Task 4.3: Install command Effect

**Outcome:** `installIdeExtension` returns the same `IdeInstallResult` on success/skip/failure.

**Files:**

- Modify: `src/pi/install.ts`
- Test: `test/install.test.ts`

**Steps:**

- [ ] Implement `installIdeExtensionEffect(candidate, runtime?, options?): Effect.Effect<IdeInstallResult, never, never>` that **always succeeds with a result object** (errors encoded in `success: false`), matching current control flow.
- [ ] Use `InstallCommandError` internally if useful, then map to `IdeInstallResult.error` / `stderr`.
- [ ] Preserve skip when `!needsInstall`.
- [ ] Preserve extension id `balaenis.pi-x-ide` and target version `PI_X_IDE_VERSION`.
- [ ] Facade remains `async function installIdeExtension(...): Promise<IdeInstallResult>`.
- [ ] Do not change `maybeAutoInstallAndReconnect` messaging in `index.ts` unless compile requires it.

**Validation:**

- Run: `mise run test`
- Expected: install success/failure/skip tests pass.

### Task 4.4: Call-site compile check

**Outcome:** Auto-install path in `index.ts` still type-checks.

**Files:**

- Verify: `src/pi/index.ts`

**Steps:**

- [ ] Ensure imports and awaits still valid.
- [ ] No Effect types in `index.ts` in this phase.

**Validation:**

- Run: `mise run typecheck && mise run test`
- Expected: exit 0

---

## Final Validation

- Run: `mise run typecheck`
- Expected: exit 0
- Run: `mise run test`
- Expected: exit 0
- Manual (optional): with a missing extension and auto-install on, confirm install attempt messages unchanged.

---

## Failure Behavior

- CLI missing — candidate absent or low confidence per current rules; no throw.
- `--list-extensions` fails — `listError` set; `reason` may be `unknown`.
- Install command non-zero — `success: false`, stderr/error populated; session continues.
- Timeout — same as current install timeout handling.

## Privacy and Security

- Do not log full command environments.
- Stderr may appear in user-facing install warnings (existing behavior); avoid adding tokens to install commands.

## Rollout Notes

- Parallelizable with Phase 3 after Phase 1.
- No config schema change unless new env vars are added (do not add any in this phase).

## Risks and Mitigations

- **Flaky tests from real CLI** — keep exec injectable or stubbed as tests already do; do not call real `code` in unit tests.
- **Result shape drift** — assert full `IdeInstallResult` fields in tests.

## Open Questions

- None.
