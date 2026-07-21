# Effect Adoption — Overview & Constraints

**Goal:** Shared decisions every phase plan must obey so slices stay mergeable and independently shippable.

**Inputs:** Repo structure 2026-07-21; existing error/schema/async patterns under `src/shared/*` and `src/pi/*`.

**Assumptions:**

- Keep `effect@^3.22.0`; do not add `@effect/platform*` or `@effect/vitest` until a phase explicitly requires them.
- Public APIs used by tests, VS Code (`@shared/*`), and Pi host callbacks stay Promise/sync-friendly.
- Effect is an implementation detail behind thin adapters and boundary runners.
- Each phase ends with a green tree (`mise run typecheck` + `mise run test`).

**Architecture:** Bottom-up adoption:

1. Tagged errors + boundary runners  
2. Schema validation  
3. IO programs (discovery, host, install)  
4. Connection handshake at Promise boundaries  
5. Optional long-lived fibers (reconnect, Zed poll)  

Callback-driven sockets and Pi lifecycle events remain entry points that *run* Effects. They do not become fibers until Phase 6.

**Tech Stack:** TypeScript (NodeNext), Effect 3.22, `node:test` via `mise run test`, `ws`, Bun/mise toolchain, VS Code esbuild for `@shared/*`.

---

## Current structure

```text
src/
  shared/   protocol, hand-rolled schema, errors, lock-file, ide-server, config
  pi/       extension entry, connection, discovery, zed, install, UI, commands
  nvim/     Neovim sidecar (JSON lines + WebSocket)
ide-plugins/
  vscode/   imports @shared/* (protocol, format, errors, ide-server, lock-file)
  jetbrains/ out of scope
  nvim/     out of scope for Effect rewrite
test/       node:test → compile → dist/test/*.test.js
```

| Area | Current pattern | Effect fit | First phase |
| --- | --- | --- | --- |
| `src/shared/schema.ts` | Hand-rolled guards | High | 2 |
| `src/shared/errors.ts`, `src/pi/safety.ts` | try/catch swallow | High | 1, 5 |
| `src/pi/discovery.ts` | nested try/catch Promise | High | 3 |
| `src/pi/ide-host.ts` | async host resolve | High | 3 |
| `src/pi/install.ts` | CLI exec + result objects | Medium | 4 |
| `src/pi/connection.ts` | class + callbacks | Medium | 5 |
| `src/pi/zed.ts`, reconnect | timers | Medium | 6 |
| `src/pi/ui.ts`, `state.ts` | mutable runtime | Low early | keep as-is |

---

## Cross-cutting rules

### Boundary rule

- Never throw Effect failures into Pi host callbacks or VS Code activation.  
- Exit Effects with `Effect.runPromise` / `Effect.runSync` (or helpers from Phase 1).  
- On failure: log via `logExtensionError`, optionally set `runtime.connectionStatus = "error"`.

### API stability rule

- Keep existing exported names and return shapes used by tests and plugins (`isIdeLockFile`, `discoverIdeCandidates`, `IdeConnection.connect`, `IdeInstallResult`, etc.).  
- Add Effect variants as `*Effect` functions next to facades when useful.

### Import style (enforce in review)

```ts
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Data from "effect/Data";
```

Prefer subpath imports for tree-shaking in the VS Code bundle.

### Security rule

- Do not log `authToken` or full lock JSON.  
- UI/log messages may include host/port/name only.  
- Schema must not weaken required auth/host/port fields.

### Bundle rule

- After any change imported by `ide-plugins/vscode` via `@shared/*`, measure `ide-plugins/vscode/out/extension.js` size.  
- If VSIX/js grows >10% vs baseline on main, split decode runtime Pi-side and keep light type guards in shared (documented escape hatch in Phase 2).

---

## Independence model

| Phase | Can merge alone? | Notes |
| --- | --- | --- |
| 1 Foundations | Yes | No product behavior change required |
| 2 Schema | Yes | Adapters keep `schema.ts` API; works without discovery Effect |
| 3 Discovery/host | Yes | Needs Phase 1 runners/errors; Schema optional |
| 4 Install | Yes | Needs Phase 1 only; parallel with Phase 3 |
| 5 Connection | Yes | Needs Phase 1; Schema decode if Phase 2 done |
| 6 Fibers | Yes, optional | Only after Phase 5 stable |
| 7 Docs | Yes | Can start after Phase 1–2 |

---

## Open product decisions (defaults applied)

| Question | Default |
| --- | --- |
| Schema in `@shared` (VS Code bundle)? | Yes; split if size regresses >10% |
| Include fibers in first milestone? | No — stop at Phase 5 for v1 adoption |
| Add `@effect/platform-node`? | No until a phase proves need |

---

## Success criteria for the program

- At least Phases 1–2 merged and used by production decode/error paths  
- Phases 3–5 each leave public APIs and tests green  
- Contributor docs (Phase 7) explain boundary rules  
- Phase 6 optional; not a blocker for “Effect adopted”  
