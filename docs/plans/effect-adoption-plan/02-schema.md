# Phase 2: Protocol Schema

**Goal:** Validate lock files, editor snapshots, and JSON-RPC notification params with Effect Schema while keeping existing `is*` / `parse*` APIs stable.

**Inputs:** [Overview](./00-overview.md); `src/shared/schema.ts`, `src/shared/protocol.ts`, protocol tests in `test/shared.test.ts`.

**Assumptions:**

- Phase 1 is merged (or land Schema-only first and introduce `LockFileParseError` here if Phase 1 slips — prefer Phase 1 first).
- On-wire JSON shapes do not change.
- VS Code currently does **not** import `schema.ts`; Pi and tests do. Still treat shared decode as potentially bundle-sensitive if import graph changes.
- Adapter functions keep returning `boolean` or `T | undefined` (not `Either`) at the public surface.

**Architecture:** Define Effect Schemas in `effect-schema.ts`. Reimplement `schema.ts` exports as thin adapters (`Schema.decodeUnknownEither` / equivalent). Call sites (`connection.ts`, `discovery.ts`, sidecar) keep importing from `schema.ts`.

**Tech Stack:** `effect/Schema`, existing protocol types, `node:test`.

**Depends on:** Phase 1 recommended (`LockFileParseError` optional for internal decode).

**Out of scope:** Changing protocol types in `protocol.ts`; rewriting connection/discovery control flow; adding Schema to VS Code selection capture.

---

## File Map

- Create: `src/shared/effect-schema.ts` — Schema definitions + decode helpers
- Modify: `src/shared/schema.ts` — adapters preserving exported function names
- Modify: `test/shared.test.ts` — keep existing cases; add negative decode cases
- Optional: export Schema types for later phases (do not force `src/pi/*` imports yet)

---

## Tasks

### Task 2.1: Define Effect Schemas

**Outcome:** All payloads currently validated in `schema.ts` have Schema equivalents with equal strictness.

**Files:**

- Create: `src/shared/effect-schema.ts`

**Steps:**

- [ ] ABOUTME header describing protocol Schema definitions and decode helpers.
- [ ] Implement schemas matching current guards:

| Schema                          | Key constraints (must preserve)                                                                                                                                   |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Position`                      | finite number, `line >= 0`, `character >= 0`                                                                                                                      |
| `SelectionRange`                | `text: string`, nested positions                                                                                                                                  |
| `IdeSource`                     | `"vscode" \| "zed" \| "nvim" \| "jetbrains" \| "unknown"`                                                                                                         |
| `IdeLockFile`                   | `version === 1`, `transport === "ws"`, port 1–65535, string host/token/name/timestamps, `workspaceFolders: string[]`, optional `pid`, optional `runningInWindows` |
| `EditorSelectionSnapshot`       | source, filePath, ranges[], optional workspaceFolder/receivedAt                                                                                                   |
| `SelectionClearedParams`        | source + `reason === "no-active-editor"`                                                                                                                          |
| `AtMentionedParams`             | snapshot fields + `rangeText: string`                                                                                                                             |
| `IdeDiagnostic` + related types | severity `error\|warning`, ranges, contextLines, optional relatedInformation                                                                                      |
| `DiagnosticFixRequestedParams`  | `source === "vscode"`, non-empty diagnostics, triggerRange, optional action                                                                                       |
| `JsonRpcRequest`                | `jsonrpc === "2.0"`, id string\|number, method string                                                                                                             |

- [ ] Prefer filters/refinements over post-decode asserts so invalid values fail decode.
- [ ] Provide internal helpers:

```ts
export function decodeLockFile(input: unknown): IdeLockFile | undefined;
export function decodeEditorSelectionSnapshot(input: unknown): EditorSelectionSnapshot | undefined;
// ... one helper per former is*/parse* as needed
```

- [ ] `parseJsonObject` may stay hand-rolled (JSON.parse + record check) or use Schema; behavior on throw → `undefined` must remain.

**Validation:**

- Run: `mise run typecheck`
- Expected: exit 0.

### Task 2.2: Adapter layer in `schema.ts`

**Outcome:** Existing exports delegate to Effect Schema without call-site changes.

**Files:**

- Modify: `src/shared/schema.ts`

**Steps:**

- [ ] Keep exported function names and signatures identical.
- [ ] Implement `isX(value)` as `decodeX(value) !== undefined` (or `Either` match).
- [ ] `parseLockFileContent(content)`: parse JSON object then decode lock; invalid → `undefined`.
- [ ] Remove dead private hand guards only when fully replaced; no partial dual-maintenance.
- [ ] Do not change imports in `connection.ts` / `discovery.ts` in this phase unless required for compile.

**Validation:**

- Run: `mise run test`
- Expected: existing lock/snapshot tests pass unchanged.

### Task 2.3: Negative and edge tests

**Outcome:** Decode fails closed on known bad payloads.

**Files:**

- Modify: `test/shared.test.ts`

**Steps:**

- [ ] Invalid lock: `port: 0`, `port: 70000`, missing `authToken`, wrong `version`.
- [ ] Invalid selection cleared: wrong reason.
- [ ] Invalid diagnostic request: empty diagnostics array, non-vscode source.
- [ ] Valid fixtures still decode (reuse existing snapshot fixtures).
- [ ] Malformed JSON string → `parseLockFileContent` → `undefined`.

**Validation:**

- Run: `mise run test`
- Expected: exit 0.

### Task 2.4: Bundle sanity (shared impact check)

**Outcome:** Confirm VS Code bundle not unexpectedly pulled into Schema if import graph unchanged; baseline recorded.

**Files:**

- None required (command only); note result in PR description.

**Steps:**

- [ ] Run `mise run build` (or `compile:vsix` path used by project).
- [ ] Record `wc -c ide-plugins/vscode/out/extension.js` before/after if `schema` becomes imported by vscode (today it is not — expect ~0 delta).
- [ ] If a future change imports `effect-schema` into vscode paths and size grows >10%, apply escape hatch: move decode to `src/pi/` and leave boolean guards in shared.

**Validation:**

- Run: `mise run build`
- Expected: exit 0.

---

## Final Validation

- Run: `mise run typecheck && mise run test`
- Expected: both exit 0
- Manual: none required (decode-only)

---

## Failure Behavior

- Decode failure — return `undefined` / `false`; callers delete stale locks or ignore notifications (unchanged).
- JSON parse throw — catch → `undefined`.

## Privacy and Security

- Do not include raw lock content in decode error logs by default.
- Required `authToken: string` remains mandatory on lock schema.

## Rollout Notes

- One PR after Phase 1.
- No `generate:config-schema` needed.

## Risks and Mitigations

- **Strictness mismatch** — port tests first; compare old vs new on fixtures.
- **Schema bundle cost later** — escape hatch documented above.
- **Type duplication** — Schema can use `Schema.Struct` inferred types; keep `protocol.ts` interfaces as source of truth and assert assignability in typecheck (e.g. helper returning `IdeLockFile`).

## Open Questions

- None if Phase 1 merged. If Phase 1 not merged: define `LockFileParseError` only if you choose not to return `undefined` for adapters (adapters should still return `undefined` publicly).
