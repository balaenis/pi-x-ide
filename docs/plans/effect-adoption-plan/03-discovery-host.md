# Phase 3: Discovery & Host Resolution

**Goal:** Implement IDE lock-file discovery and host resolution as Effect programs behind stable Promise facades, preserving ranking and skip/delete semantics.

**Inputs:** [Overview](./00-overview.md); `src/pi/discovery.ts`, `src/pi/ide-host.ts`; discovery/host tests in `test/shared.test.ts`, `test/connection.test.ts`.

**Assumptions:**

- Phase 1 merged (`runEffect`, tagged errors available).
- Phase 2 optional: if present, use `parseLockFileContent` / Schema adapters; else keep current parser import.
- Discovery remains **best-effort**: per-entry failures skip; function does not reject for missing dirs.
- Injectable `tcpProbe`, `resolveHost`, `env`, and path overrides remain for tests.

**Architecture:** Extract `discoverIdeCandidatesEffect` and host-resolution Effects. Public `discoverIdeCandidates` / `resolveBestIdeCandidate` / `resolveIdeHost` call `Effect.runPromise` (or `runEffect` only where swallow is desired — discovery should surface unexpected defects as empty/skip, not UI error). Ranking pure functions stay pure.

**Tech Stack:** Effect, `node:fs/promises`, existing platform/path helpers.

**Depends on:** Phase 1.

**Out of scope:** WebSocket connect; install; changing lock format; fiber-based watchers.

---

## File Map

- Modify: `src/pi/discovery.ts` — Effect program + Promise facade
- Modify: `src/pi/ide-host.ts` — Effect host resolution + Promise facade
- Modify: `test/shared.test.ts` — discovery regressions
- Modify: `test/connection.test.ts` — host resolution regressions
- Optional Create: `src/pi/discovery-effect.ts` only if `discovery.ts` exceeds maintainability (~300+ lines); prefer single file first

---

## Tasks

### Task 3.1: Host resolution Effect

**Outcome:** `resolveIdeHost` behavior unchanged; internal Effect composition for override → WSL gateway → lock host → TCP probe paths.

**Files:**

- Modify: `src/pi/ide-host.ts`
- Test: `test/connection.test.ts`

**Steps:**

- [ ] Read current resolution order in `ide-host.ts` and encode it as `resolveIdeHostEffect(lock, options)`.
- [ ] Preserve env override `PI_X_IDE_HOST_OVERRIDE` (constant already in file).
- [ ] Preserve WSL Windows lock gateway detection and `tcpReachable` timeout `IDE_HOST_TCP_PROBE_TIMEOUT_MS`.
- [ ] Keep exported `async function resolveIdeHost(...): Promise<string>` as facade.
- [ ] Keep pure helpers (`parseDefaultGateway`, etc.) as plain functions.
- [ ] Map unexpected command failures to fallback host per **current** code behavior (do not invent stricter failure).

**Validation:**

- Run: `mise run test`
- Expected: host override / WSL gateway tests pass.

### Task 3.2: Discovery Effect program

**Outcome:** `discoverIdeCandidates` returns the same ranked candidates with the same cleanup side effects.

**Files:**

- Modify: `src/pi/discovery.ts`
- Test: `test/shared.test.ts`

**Steps:**

- [ ] Keep pure `sortCandidates` and workspace match helpers unchanged in behavior.
- [ ] Implement `discoverIdeCandidatesEffect(options): Effect.Effect<LockFileCandidate[], never, never>` (or error channel only for true defects — prefer `never` and internal catch).
- [ ] Per lock dir:
  - `readdir` failure → empty for that dir
  - non-`.lock` skip
  - read/stat failure → continue
  - age > `maxAgeMs` → `rm` force + continue
  - parse failure → `rm` force + continue
  - dead pid (with Windows+WSL reachability exception) → same as current `isDeadWindowsPidLockReachable` path
- [ ] Use Phase 1 errors only if you log structured causes; do not change user-visible discovery success shape.
- [ ] `discoverIdeCandidates` = run the Effect and return candidates (should not return `undefined`; preserve `Promise<LockFileCandidate[]>`).
- [ ] `resolveBestIdeCandidate` remains first element of sorted list.

**Validation:**

- Run: `mise run test`
- Expected: discovery, stale lock deletion, WSL dead-pid reachability cases pass.

### Task 3.3: Wire call sites (no behavior change)

**Outcome:** Callers still use Promise APIs; no Effect types leak into `index.ts`.

**Files:**

- Modify: only if signatures change (should not)
- Verify: `src/pi/index.ts`, `src/pi/commands.ts` still compile against facades

**Steps:**

- [ ] Grep for `discoverIdeCandidates` / `resolveIdeHost` / `resolveBestIdeCandidate` and confirm no signature breaks.
- [ ] Do not convert `index.ts` session handlers to Effect in this phase.

**Validation:**

- Run: `mise run typecheck && mise run test`
- Expected: exit 0

---

## Final Validation

- Run: `mise run typecheck`
- Expected: exit 0
- Run: `mise run test`
- Expected: exit 0
- Manual (optional): start Pi in a multi-lock environment; `/ide` lists same candidates order as before.

---

## Failure Behavior

- Missing lock directory — empty list, no throw.
- Single corrupt lock — delete + skip.
- TCP probe failure for dead Windows pid under WSL — treat unreachable → delete + skip (current behavior).
- Host resolve failure during discovery probe — `false` reachability / continue per current code.

## Privacy and Security

- Do not log `authToken` when parsing/deleting locks.
- Deleting malformed locks remains intentional hygiene.

## Rollout Notes

- Independent PR from Phase 4.
- No config schema regeneration.

## Risks and Mitigations

- **Semantic drift on skip/delete** — port existing tests before refactor; add case if a branch lacks coverage.
- **Effect error channel vs never** — prefer matching today’s non-throwing discovery; use `Effect.catchAll` around entry IO.

## Open Questions

- None.
