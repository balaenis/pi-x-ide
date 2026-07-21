# Phase 1: Effect Foundations

**Goal:** Introduce tagged domain errors and safe Effect boundary runners with zero product behavior change.

**Inputs:** [Overview](./00-overview.md); current `src/shared/errors.ts`, `src/pi/safety.ts`.

**Assumptions:**

- `effect@^3.22.0` is already installed; do not change the pin unless install is broken.
- No call sites in `src/pi/*` product paths need rewiring in this phase (tests may exercise new helpers).
- Existing `Error` subclasses (e.g. `IdeConnectionTimeoutError` in `connection.ts`) stay until Phase 5.

**Architecture:** Add two small shared modules: tagged errors (`Data.TaggedError`) and run helpers that log and swallow failures the same way `safeRun*` does. Later phases import these modules; this phase only proves they compile and unit-test.

**Tech Stack:** Effect `Data`, `Effect`; `node:test`; `mise run typecheck` / `mise run test`.

**Depends on:** None.

**Out of scope:** Schema, discovery, connection, install rewrites; changing `safeRun` signatures; VS Code plugin changes.

---

## File Map

- Create: `src/shared/effect-errors.ts` — tagged domain errors
- Create: `src/shared/effect-runtime.ts` — `runEffect` / `runEffectSync` / test-only throw runner
- Modify: `test/shared.test.ts` — unit tests for runners and error tags
- Optional Modify: `src/shared/errors.ts` — re-export only if it reduces import churn (prefer not; keep modules explicit)

---

## Tasks

### Task 1.1: Tagged domain errors

**Outcome:** Shared tagged error classes exist for failures later phases will raise.

**Files:**

- Create: `src/shared/effect-errors.ts`
- Test: `test/shared.test.ts`

**Steps:**

- [ ] Add file header:
  - `// ABOUTME: Defines Effect tagged domain errors for pi-x-ide shared and Pi-side workflows.`
  - `// ABOUTME: Keeps failure types structured without changing on-wire protocol payloads.`
- [ ] Define at least:

```ts
// shapes are normative; field names must match in later phases
export class LockFileParseError extends Data.TaggedError("LockFileParseError")<{
  readonly path?: string;
  readonly reason: string;
}> {}

export class LockDirReadError extends Data.TaggedError("LockDirReadError")<{
  readonly path: string;
  readonly cause: unknown;
}> {}

export class IdeConnectTimeoutError extends Data.TaggedError("IdeConnectTimeoutError")<{
  readonly name: string;
  readonly host: string;
  readonly port: number;
}> {}

export class IdeConnectError extends Data.TaggedError("IdeConnectError")<{
  readonly host: string;
  readonly port: number;
  readonly cause: unknown;
}> {}

export class ConfigParseError extends Data.TaggedError("ConfigParseError")<{
  readonly path: string;
  readonly reason: string;
}> {}

export class InstallCommandError extends Data.TaggedError("InstallCommandError")<{
  readonly cli: string;
  readonly code?: number | null;
  readonly stderr: string;
  readonly stdout?: string;
}> {}
```

- [ ] Export a small `isTaggedError(u: unknown): u is { _tag: string }` helper only if tests need it; otherwise use `_tag` checks inline in tests.
- [ ] Do not replace `IdeConnectionTimeoutError` class in this phase.

**Validation:**

- Run: `mise run typecheck`
- Expected: exit 0; new file type-checks under `strict`.

### Task 1.2: Boundary runners

**Outcome:** Effects can be executed at process boundaries with the same log-and-swallow semantics as `safeRun*`.

**Files:**

- Create: `src/shared/effect-runtime.ts`
- Test: `test/shared.test.ts`

**Steps:**

- [ ] Add file header:
  - `// ABOUTME: Runs Effect programs at Pi and IDE process boundaries.`
  - `// ABOUTME: Converts failures into logged outcomes without rethrowing into hosts.`
- [ ] Implement:

```ts
// normative API
export function runEffect<A>(
  scope: string,
  effect: Effect.Effect<A, unknown, never>,
  onError?: (error: unknown) => void,
): Promise<A | undefined>;

export function runEffectSync<A>(
  scope: string,
  effect: Effect.Effect<A, unknown, never>,
  onError?: (error: unknown) => void,
): A | undefined;

/** Test / internal only — does not swallow */
export function runEffectOrThrow<A>(effect: Effect.Effect<A, unknown, never>): Promise<A>;
```

- [ ] Failure path must call `onError` if provided, else `logExtensionError(scope, error)` from `errors.ts`.
- [ ] Map Effect failures to `unknown` consistently (prefer `Cause.squash` or `Effect.runPromise` rejection body); document choice in a one-line comment.
- [ ] Do not depend on `@effect/platform`.
- [ ] Keep `R = never` for phase-1 helpers (no Layers yet). If a later phase needs services, extend runners then.

**Validation:**

- Run: `mise run typecheck`
- Expected: exit 0.

### Task 1.3: Unit tests

**Outcome:** Runners and tags are covered without coupling to discovery/connection.

**Files:**

- Modify: `test/shared.test.ts`

**Steps:**

- [ ] Test success path: `runEffectSync("t", Effect.succeed(1)) === 1`.
- [ ] Test failure path: failing Effect returns `undefined`, invokes `console.error` or custom `onError`.
- [ ] Test `LockFileParseError` has `_tag === "LockFileParseError"`.
- [ ] Test async `runEffect` resolves value and swallows rejection-style failures.
- [ ] Do not delete existing shared tests.

**Validation:**

- Run: `mise run test`
- Expected: all tests pass, including new Effect foundation cases.

---

## Final Validation

- Run: `mise run typecheck`
- Expected: exit 0
- Run: `mise run test`
- Expected: exit 0
- Run: `mise run build` (optional but recommended once)
- Expected: exit 0; VS Code bundle still builds (new modules unused by vscode yet is fine)

---

## Failure Behavior

- Runner failure — log + return `undefined`; never rethrow when using `runEffect` / `runEffectSync`.
- `runEffectOrThrow` — propagates failure for tests only.

## Privacy and Security

- Runners must not specially serialize secrets; callers must not put tokens in `scope` strings.

## Rollout Notes

- Single PR; no config schema changes.
- Safe to merge with no user-visible change.

## Risks and Mitigations

- **Over-wide error union early** — only add tags listed above; add more in the phase that needs them.
- **R parameter creep** — keep `never` until Layer adoption is intentional.

## Open Questions

- None for this phase.
