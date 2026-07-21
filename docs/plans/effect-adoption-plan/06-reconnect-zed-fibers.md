# Phase 6: Reconnect & Zed Fibers (Optional)

**Goal:** Replace reconnect `setTimeout` chains and Zed poll timers with interruptible Effect fibers, scoped to Pi session generation.

**Inputs:** [Overview](./00-overview.md); `src/pi/reconnect.ts`, `src/pi/zed.ts`, `src/pi/index.ts`, `src/pi/state.ts`; `test/zed.test.ts`, reconnect tests in `test/connection.test.ts`.

**Assumptions:**

- Phases 1–5 merged and stable on main.
- This phase is **optional** for “Effect adopted”; do not block earlier phases.
- User-visible reconnect limits (`MAX_RECONNECT_ATTEMPTS`) and Zed poll interval env remain.
- Mutable `PiIdeRuntime` stays; add fiber handles beside or instead of timer fields.

**Architecture:** On disconnect, fork a reconnect Effect that sleeps, rediscovers/connects, and self-limits attempts. On Zed terminal detection, fork a spaced Schedule poll interrupted on session shutdown / stopZedPolling. Session generation or explicit `Fiber.interrupt` cancels work.

**Tech Stack:** Effect `Fiber`, `Schedule`, `Effect.sleep`, existing zed snapshot pure logic.

**Depends on:** Phase 5 (connection Effect + boundary). Soft: Phase 3 discovery.

**Out of scope:** STM/Ref rewrite of all runtime state; Layer-based app graph; `@effect/vitest` migration (optional follow-up).

---

## File Map

- Modify: `src/pi/state.ts` — optional `reconnectFiber` / `zedPollFiber` fields; remove timer fields when unused
- Modify: `src/pi/reconnect.ts` — attempt counters stay; scheduling moves out
- Modify: `src/pi/zed.ts` — `startZedPolling` / `stopZedPolling` fiber lifecycle
- Modify: `src/pi/index.ts` — start/stop fibers on session events
- Modify: `test/zed.test.ts`, `test/connection.test.ts`
- Optional: do not add `@effect/platform` unless SQLite access needs it (keep current DB access)

---

## Tasks

### Task 6.1: Runtime fiber handles

**Outcome:** Runtime can track fibers; old timers cleared on transition.

**Files:**

- Modify: `src/pi/state.ts`
- Modify: `src/pi/index.ts` shutdown path

**Steps:**

- [ ] Add optional fields, e.g. `reconnectFiber?: Fiber.RuntimeFiber<void, never>` and `zedPollFiber?: ...` (exact Effect 3.22 types as implemented).
- [ ] On `session_shutdown`: interrupt both fibers; clear handles; keep existing connection.disconnect().
- [ ] During migration, if both timer and fiber exist, stopping one stops both.

**Validation:**

- Run: `mise run typecheck`
- Expected: exit 0

### Task 6.2: Reconnect program

**Outcome:** Same max attempts and messages; no reconnect after user disable/disconnect.

**Files:**

- Modify: `src/pi/reconnect.ts`, `src/pi/index.ts`
- Test: `test/connection.test.ts`

**Steps:**

- [ ] Keep `recordReconnectAttempt` / `resetReconnectState` / `formatReconnectLimitMessage` pure behavior.
- [ ] Replace `setTimeout(..., RECONNECT_DELAY_MS)` with Effect sleep (`RECONNECT_DELAY_MS = 2000`).
- [ ] Interrupt on: manual disconnect, disable, session generation change, successful connect path that resets state.
- [ ] Preserve per-candidate attempt key behavior.

**Validation:**

- Run: `mise run test`
- Expected: reconnect cap tests pass; add interrupt/generation test if feasible with fake clocks — if not, document manual check.

### Task 6.3: Zed poll Schedule

**Outcome:** Polling interval and WAL mtime short-circuit unchanged; stop is prompt.

**Files:**

- Modify: `src/pi/zed.ts`
- Test: `test/zed.test.ts`

**Steps:**

- [ ] Keep pure snapshot/DB helpers as plain functions (majority of `zed.ts`).
- [ ] `startZedPolling`: fork loop `Schedule.spaced(interval)` (clamp 100–2000 ms via existing env).
- [ ] `stopZedPolling`: interrupt fiber; idempotent.
- [ ] `isZedTerminal()` false or missing DB → no fiber (return false / no side effects) — preserve current early exit.
- [ ] Selection updates still go through existing runtime + UI callbacks.

**Validation:**

- Run: `mise run test`
- Expected: all zed unit tests pass (most are pure snapshot tests).

### Task 6.4: Session integration smoke

**Outcome:** Start/shutdown does not leave fibers or timers.

**Files:**

- Modify: `src/pi/index.ts`

**Steps:**

- [ ] `session_start`: cancel prior fibers before new connect/poll.
- [ ] `session_shutdown`: interrupt + disconnect + clear UI (existing order preserved as much as possible).
- [ ] Ensure generation bump invalidates in-flight reconnect.

**Validation:**

- Run: `mise run typecheck && mise run test`
- Expected: exit 0
- Manual: toggle IDE connection; start Pi in Zed terminal if available; shutdown session cleanly.

---

## Final Validation

- Run: `mise run typecheck && mise run test && mise run build`
- Expected: all exit 0
- Manual: reconnect after killing IDE WS; Zed poll updates selection without leaks after `/ide` disconnect.

---

## Failure Behavior

- Reconnect exhausted — show limit message; stop fiber; status disconnected/error per current UX.
- Zed poll iteration throw — log, continue or stop per current `zed.ts` error handling (preserve; do not invent infinite silent fail without log).
- Interrupt — treated as success cancellation, not UI error.

## Privacy and Security

- Unchanged; no new network surfaces.

## Rollout Notes

- Separate PR after Phase 5 soak.
- Feature-flag not required if tests cover caps; keep easy revert.

## Risks and Mitigations

- **Fiber leaks** — always interrupt on shutdown; assert handles undefined after stop in unit tests where possible.
- **Test flakiness with real time** — prefer injectable clock/schedule or short intervals in tests; keep pure zed tests dominant.
- **Over-scope into full Layer app** — stop when timers are gone; do not refactor UI state to Ref in this phase.

## Open Questions

- Whether to introduce `TestClock` in `node:test` (no first-class Effect test util) — default: avoid; test pure counters + manual smoke.
