# Implementation Plan

**Goal:** Resolve the round-1 Standards findings by naming the WSL reachability helper for its actual scope and by describing authoritative WSL TCP reachability directly in both discovery documentation mirrors.

**Inputs:** The round-1 review findings under `## Standards`; the implementation summary for Issue #50; repository evidence from `src/pi/discovery.ts`, `test/shared.test.ts`, and the English and Chinese discovery explanation files; the `writing-plans` and `tdd` skills. The review has no Spec findings.

**Assumptions:**

- The review findings confirm the seams in this plan. No additional seam confirmation is necessary.
- The helper rename is a private, behavior-preserving standards correction. A new test for the private name would couple tests to implementation. Therefore, this task uses a failing structural acceptance check for red and the existing public `discoverIdeCandidates()` WSL tests for behavioral green validation.
- Documentation review checks are the red step for the documentation-only slice. No executable product behavior changes in that slice.

**Architecture:** Keep the existing discovery control flow and WSL TCP authority unchanged. Rename only the private helper and its single call site. Replace the obsolete dead-PID cross-reference in both explanation mirrors with direct text that says WSL TCP reachability is authoritative and a Windows PID is not Linux process-liveness evidence.

**Tech Stack:** TypeScript, Effect, Node.js test runner, Markdown, Prettier, and Mise.

---

## Scope Boundaries

- Address both Standards findings and no additional cleanup.
- Do not change discovery behavior, lock-file policy, TCP probing, PID validation, error containment, protocol text, troubleshooting text, heartbeat code, schema, configuration, or protocol version.
- Do not add a test for a private helper name or export the helper for testing.
- Do not modify or stage the existing implementation plan or any other working-tree file.
- Preserve the two-line `ABOUTME:` header in `src/pi/discovery.ts`.
- Keep the English and Chinese discovery explanations semantically synchronized.

## File Map

- Modify: `src/pi/discovery.ts` — rename the private Windows-side WSL reachability helper and its only call site without changing behavior.
- Modify: `docs/explanation/discovery.md` — replace the obsolete dead-PID false-positive reference with a direct explanation of authoritative WSL TCP reachability.
- Modify: `docs/zh-CN/explanation/discovery.md` — mirror the corrected English explanation in Chinese.
- Test: `test/shared.test.ts` — unchanged existing public-seam coverage for reachable and unreachable Windows-side WSL locks.

## Seams

- **Seam:** `discoverIdeCandidates(options: DiscoverOptions): Promise<LockFileCandidate[]>` — verify that the private rename preserves authoritative Windows-side WSL TCP reachability through existing public behavior tests.
- **Seam:** The `## WSL2: discovering an IDE on Windows` section in `docs/explanation/discovery.md` and the mirrored `## WSL2：发现 Windows 上的 IDE` section in `docs/zh-CN/explanation/discovery.md` — explain the WSL liveness rule without relying on an undefined dead-PID false-positive term.

## Tasks

### Task 1: Rename the Windows lock reachability helper

**Finding:** `src/pi/discovery.ts:69` names the helper `isDeadWindowsPidLockReachable`, although the helper now checks every Windows-side WSL lock.

**Seam:** `discoverIdeCandidates(options: DiscoverOptions): Promise<LockFileCandidate[]>`

**Outcome:** The private helper is named `isWindowsLockReachable` at its definition and only call site. Discovery behavior remains unchanged.

**Files:**

- Modify: `src/pi/discovery.ts`
- Test: `test/shared.test.ts` (run existing tests; do not modify)

**Steps:**

- [ ] **Red, structural acceptance:** Run the exact old-name/new-name check before editing. Confirm that the command fails because `isDeadWindowsPidLockReachable` is present and `isWindowsLockReachable` is absent.
- [ ] Record the behavior baseline through the public seam by running the focused Windows-side WSL discovery tests. Confirm that they pass before the rename.
- [ ] **Green:** Rename the private function `isDeadWindowsPidLockReachable` to `isWindowsLockReachable`.
- [ ] Rename its call in the `checkPid && isWindowsSideWsl` branch to `isWindowsLockReachable`.
- [ ] Do not change the function signature, Effect type, `resolveHost` fallback, TCP probe arguments, timeout, catch behavior, or branch order.
- [ ] Do not add an export or a private-helper test.
- [ ] Re-run the structural acceptance check and the focused public-seam tests.

**Validation:**

- Run (red): `! grep -F 'isDeadWindowsPidLockReachable' src/pi/discovery.ts && test "$(grep -F -c 'isWindowsLockReachable' src/pi/discovery.ts)" -eq 2`
- Expected: The command exits nonzero before editing because the obsolete name is still present and the replacement has zero occurrences.
- Run (behavior baseline): `mise run compile && node --test --test-name-pattern='Windows-side WSL lock' dist/test/shared.test.js`
- Expected: Existing reachable, unreachable, and Linux-PID-collision WSL discovery scenarios pass before the rename.
- Run (green, structural): `! grep -F 'isDeadWindowsPidLockReachable' src/pi/discovery.ts && test "$(grep -F -c 'isWindowsLockReachable' src/pi/discovery.ts)" -eq 2`
- Expected: The command exits zero. The old name has no match, and the new name appears exactly at the private definition and call site.
- Run (green, behavior): `mise run compile && node --test --test-name-pattern='Windows-side WSL lock' dist/test/shared.test.js`
- Expected: TypeScript compilation succeeds and the same public WSL discovery scenarios pass with no behavior change.

### Task 2: Explain authoritative WSL reachability directly

**Finding:** `docs/explanation/discovery.md:76-77` and `docs/zh-CN/explanation/discovery.md:50` refer to a dead-PID false positive that the preceding explanation no longer defines.

**Seam:** The mirrored WSL discovery sections in the English and Chinese explanation documents.

**Outcome:** Both mirrors directly state that WSL TCP reachability is authoritative for a Windows-side lock and that Pi does not treat the Windows PID as Linux process-liveness evidence. Neither file uses the obsolete dead-PID false-positive reference.

**Files:**

- Modify: `docs/explanation/discovery.md`
- Modify: `docs/zh-CN/explanation/discovery.md`

**Steps:**

- [ ] **Red, document acceptance:** Run the obsolete-term check before editing. Confirm that it fails because the English phrase `dead-PID false positive` and the Chinese phrase `死 PID 误判` are present.
- [ ] In `docs/explanation/discovery.md`, replace the two sentences after `A Windows lock file sets runningInWindows: true.` with direct mechanism text. State: when Pi runs in WSL, TCP reachability to the Windows producer is authoritative, and Pi does not use the Windows PID as Linux process-liveness evidence.
- [ ] In `docs/zh-CN/explanation/discovery.md`, apply the same meaning in Chinese. Keep one space between English/code terms and Chinese text.
- [ ] Keep this section explanation-oriented. Do not add troubleshooting steps, commands, implementation helper names, or new protocol requirements.
- [ ] Preserve the surrounding host-resolution order, links, and Zed distinction.
- [ ] **Green:** Re-run the obsolete-term check, then verify the required authoritative terms in both mirrors and run formatting validation.

**Validation:**

- Run (red): `! grep -F 'dead-PID false positive' docs/explanation/discovery.md && ! grep -F '死 PID 误判' docs/zh-CN/explanation/discovery.md`
- Expected: The command exits nonzero before editing because both obsolete references are present.
- Run (green, obsolete terms): `! grep -F 'dead-PID false positive' docs/explanation/discovery.md && ! grep -F '死 PID 误判' docs/zh-CN/explanation/discovery.md`
- Expected: The command exits zero because neither obsolete reference remains.
- Run (green, English meaning): `grep -F 'TCP reachability' docs/explanation/discovery.md && grep -F 'authoritative' docs/explanation/discovery.md && grep -F 'Windows PID' docs/explanation/discovery.md`
- Expected: The English WSL section directly contains all three required concepts.
- Run (green, Chinese meaning): `grep -F 'TCP 可达性' docs/zh-CN/explanation/discovery.md && grep -F '权威' docs/zh-CN/explanation/discovery.md && grep -F 'Windows PID' docs/zh-CN/explanation/discovery.md`
- Expected: The Chinese WSL section directly contains the mirrored concepts.
- Run (green, format): `mise run format:check`
- Expected: Prettier reports no formatting differences.

## Finding-to-Task Map

| Review finding                                                                                                                         | Task           | Resolution                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/explanation/discovery.md:76-77` and `docs/zh-CN/explanation/discovery.md:50` use an undefined dead-PID false-positive reference. | Task 2         | Replace the reference in both mirrors with direct, synchronized text about authoritative WSL TCP reachability and Windows PID handling.     |
| `src/pi/discovery.ts:69` uses the too-narrow name `isDeadWindowsPidLockReachable`.                                                     | Task 1         | Rename the private helper and its only call site to `isWindowsLockReachable`; preserve behavior through the existing public discovery seam. |
| Spec: `None.`                                                                                                                          | Scope boundary | No spec-driven implementation work is added.                                                                                                |

## Final Validation

Run after both tasks are green:

- Run: `! grep -R -F 'isDeadWindowsPidLockReachable' src test`
- Expected: No obsolete helper-name reference exists in source or tests.
- Run: `test "$(grep -F -c 'isWindowsLockReachable' src/pi/discovery.ts)" -eq 2`
- Expected: The new helper name appears exactly at the private definition and call site.
- Run: `! grep -F 'dead-PID false positive' docs/explanation/discovery.md && ! grep -F '死 PID 误判' docs/zh-CN/explanation/discovery.md`
- Expected: Neither documentation mirror contains the undefined term.
- Run: `mise run format:check`
- Expected: Formatting passes.
- Run: `mise run lint`
- Expected: ESLint reports no errors.
- Run: `mise run typecheck`
- Expected: Root TypeScript and VS Code type-check without errors.
- Run: `mise run test`
- Expected: All root tests pass, including all existing Windows-side WSL discovery cases.
- Run: `mise run build`
- Expected: The aggregate build passes with the behavior-preserving rename and documentation corrections.
- Inspect: `git diff -- src/pi/discovery.ts docs/explanation/discovery.md docs/zh-CN/explanation/discovery.md`
- Expected: The implementation diff contains only the private rename and direct mirrored explanation changes. No files are staged or committed.

## Failure Behavior

- TCP resolution or probing behavior remains unchanged. A false or thrown Windows-side WSL reachability probe still removes the lock.
- A reachable Windows-side WSL lock remains discoverable regardless of its Windows PID value or age.
- If either documentation mirror omits the authoritative TCP rule or still uses the obsolete false-positive term, Task 2 remains incomplete.

## Privacy and Security

- The plan changes no network destination, probe timeout, lock content, auth token, file permission, process check, or data handling.
- The documentation must not expose real lock data, user paths, tokens, or endpoint values.

## Rollout Notes

- Ship these corrections with the existing Issue #50 implementation.
- No migration, schema regeneration, protocol version change, configuration update, generated artifact update, or manual runtime validation is required for this review round.

## Risks and Mitigations

- **A rename can accidentally alter discovery logic.** Change only the private identifier and its single call site, then run the existing public WSL discovery tests and the full suite.
- **The mirrors can drift in meaning.** Require the same three concepts in both files: TCP reachability, authority, and Windows PID treatment.
- **A private-name test would create brittle coverage.** Use a one-time structural acceptance check and retain behavioral coverage at `discoverIdeCandidates()`.

## Open Questions

**Open Questions:** None.
