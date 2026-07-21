# Phase 5: Connection Handshake & Pi Boundary

**Goal:** Run WebSocket connect/initialize through Effect for timeout and error mapping, integrate Effect runners into Pi safety boundaries, keep `IdeConnection` class API and callback model.

**Inputs:** [Overview](./00-overview.md); `src/pi/connection.ts`, `src/pi/safety.ts`, `src/pi/index.ts`; `test/connection.test.ts`.

**Assumptions:**

- Phase 1 merged.
- Phase 2 merged preferred so notification decode uses Schema adapters (still via `schema.ts` imports).
- Phase 3 merged preferred so `resolveIdeHost` Effect is available; otherwise call existing Promise host resolve via `Effect.tryPromise`.
- Public `IdeConnection` methods (`connect`, `disconnect`, `isOpen`) and `IdeConnectionTimeoutError` class remain for tests/call sites.
- Message handlers stay synchronous and defensive (must not crash Pi).

**Architecture:** `connect()` becomes a facade over `connectEffect` that resolves host, opens socket, applies timeout, sends `initialize`. Callbacks (`onSelectionChanged`, etc.) stay imperative. `safety.ts` gains `runPiEffect` (or extends boundary helpers) so session handlers can run Effects later without leaking failures.

**Tech Stack:** Effect, `ws`, existing protocol constants, Phase 1 runners.

**Depends on:** Phase 1; Phase 2 for decode; Phase 3 for host Effect (soft).

**Out of scope:** Replacing reconnect timers with fibers (Phase 6); Zed polling rewrite; full Layer services for WebSocket.

---

## File Map

- Modify: `src/pi/connection.ts`
- Modify: `src/pi/safety.ts`
- Modify: `src/pi/index.ts` (only boundary wiring if beneficial)
- Modify: `test/connection.test.ts`
- Optional Modify: `src/shared/effect-runtime.ts` if Pi-specific mapping belongs shared (prefer Pi safety for runtime UI updates)

---

## Tasks

### Task 5.1: Connect Effect with timeout mapping

**Outcome:** Successful connect and timeout paths match current tests; timeout still throws/rejects with `IdeConnectionTimeoutError` from the Promise facade.

**Files:**

- Modify: `src/pi/connection.ts`
- Test: `test/connection.test.ts`

**Steps:**

- [ ] Implement internal `connectEffect(timeoutMs): Effect.Effect<void, IdeConnectTimeoutError | IdeConnectError, never>` (or keep class error in channel via `Effect.fail`).
- [ ] Steps inside Effect:
  1. Resolve host (`resolveHost` option or default)
  2. Create WebSocket with auth header `AUTH_HEADER` / `lock.authToken`
  3. Race open vs timeout (`IDE_CONNECT_TIMEOUT_MS` default)
  4. On timeout: terminate socket, fail with timeout error carrying candidate name/host/port
  5. On open: `sendInitialize()` then succeed
- [ ] `async connect()` facade: `Effect.runPromise(connectEffect)` and map tagged timeout → `IdeConnectionTimeoutError` **instance** so `instanceof` checks in `index.ts` / tests keep working.
- [ ] Preserve `closedByUser` / socket identity checks on close/error.
- [ ] Do not move `handleMessage` to Effect yet beyond optional Schema decode via existing adapters.

**Validation:**

- Run: `mise run test`
- Expected: timeout test, successful initialize, disconnect tests pass.

### Task 5.2: Notification decode uses Schema adapters

**Outcome:** Malformed notifications ignored; valid ones dispatch callbacks.

**Files:**

- Modify: `src/pi/connection.ts`
- Test: `test/connection.test.ts`

**Steps:**

- [ ] Keep using `isSelectionChangedParams` etc. from `schema.ts` (Phase 2 adapters).
- [ ] Preserve `normalizeEditorSelectionSnapshotForHost` and `withReceivedAt`.
- [ ] Preserve `at_mentioned` rangeText formatting via `formatRangeMention`.
- [ ] Callback errors still go through `reportError` / `onError` containment.

**Validation:**

- Run: `mise run test`
- Expected: selection/diagnostic callback containment tests pass.

### Task 5.3: Pi boundary Effect helper

**Outcome:** Session/command code can run Effects with UI error status updates.

**Files:**

- Modify: `src/pi/safety.ts`
- Optional Modify: `src/pi/index.ts`
- Test: `test/shared.test.ts` or `test/connection.test.ts` (lightweight)

**Steps:**

- [ ] Add:

```ts
export function runPiEffect<A>(
  scope: string,
  runtime: PiIdeRuntime,
  effect: Effect.Effect<A, unknown, never>,
  ctx?: ExtensionContext | ExtensionCommandContext,
): Promise<A | undefined>;
```

- [ ] On failure: `containPiError(runtime, scope, error, ctx)` (existing).
- [ ] Implementation may wrap Phase 1 `runEffect` with `onError` bound to `containPiError`.
- [ ] Optionally convert one low-risk path in `index.ts` (e.g. part of connect helper) as proof; do not wholesale rewrite session handlers.

**Validation:**

- Run: `mise run typecheck && mise run test`
- Expected: exit 0

### Task 5.4: Session generation safety regression

**Outcome:** Connect after shutdown / generation bump still cancels logical work (no stale UI writes).

**Files:**

- Verify: `src/pi/index.ts` generation guards around awaits

**Steps:**

- [ ] After any new `await` introduced by Effect facades, keep `isInstallSessionActive` / generation checks as today.
- [ ] Add a test only if a guard is easy to unit-test; otherwise manual note in PR.

**Validation:**

- Run: `mise run test`
- Expected: exit 0

---

## Final Validation

- Run: `mise run typecheck && mise run test`
- Expected: exit 0
- Manual: `pi -e ./src/pi/index.ts` with VS Code extension running — connect, select text, attach shortcut, disconnect IDE, observe status transitions.

---

## Failure Behavior

- Connect timeout — reject with `IdeConnectionTimeoutError`; UI message via existing `formatConnectTimeoutMessage`.
- Socket error before open — reject/fail connect; onError path as today.
- Callback throw — contained; optional runtime error status via `onError` handlers in `index.ts`.
- `runPiEffect` failure — log + `connectionStatus = "error"` + UI update.

## Privacy and Security

- Auth token only in upgrade headers; never in Effect error messages or logs.
- Timeout errors include host/port/name only.

## Rollout Notes

- Land after Phases 1–2 (3 recommended).
- Single focused PR; avoid combining with Phase 6.

## Risks and Mitigations

- **`instanceof` breakage** — always map to existing Error class at Promise facade.
- **Double socket handlers** — ensure Effect open path does not register duplicate open listeners vs facade.
- **Promise vs Effect cancellation** — Phase 5 does not require interrupt; Phase 6 adds fibers.

## Open Questions

- None blocking; fiberized reconnect deferred to Phase 6 by design.
