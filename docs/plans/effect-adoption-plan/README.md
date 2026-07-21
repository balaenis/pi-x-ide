# Effect Adoption Plan Index

**Goal:** Incrementally adopt Effect 3.x in `pi-x-ide` for typed errors, Schema validation, and composable async workflows, without rewriting IDE plugins or breaking Pi extension boundaries.

**Status:** Planned (not started)

**Inputs:** Repository as of 2026-07-21; `package.json` already depends on `effect@^3.22.0` with zero source imports.

## Phase Map

| Phase | Plan | Ships independently? | Depends on | Risk |
| --- | --- | --- | --- | --- |
| 0 | [Overview & constraints](./00-overview.md) | N/A (reference) | — | — |
| 1 | [Foundations](./01-foundations.md) | Yes | — | Low |
| 2 | [Protocol Schema](./02-schema.md) | Yes | Phase 1 recommended | Low–Med |
| 3 | [Discovery & host](./03-discovery-host.md) | Yes | Phase 1 | Med |
| 4 | [Install workflow](./04-install.md) | Yes | Phase 1 | Med |
| 5 | [Connection & Pi boundary](./05-connection-boundary.md) | Yes | Phase 1; Phase 2 for decode; Phase 3 for host Effect | Med |
| 6 | [Reconnect & Zed fibers](./06-reconnect-zed-fibers.md) | Yes (optional) | Phase 5 | High |
| 7 | [Documentation](./07-documentation.md) | Yes | Phase 1–2 content to document | Low |

## Suggested PR order

1. Phase 1 → foundations  
2. Phase 2 → schema (+ optional Phase 7 draft)  
3. Phase 3 and Phase 4 in parallel (both only need Phase 1)  
4. Phase 5 → connection  
5. Phase 7 finalize  
6. Phase 6 only after 1–5 are stable  

## Global gates (every phase)

```bash
mise run typecheck
mise run test
```

After phases that touch `@shared/*` consumed by VS Code:

```bash
mise run build
# optional: compare ide-plugins/vscode/out/extension.js size vs main
```

## Non-goals (all phases)

- JetBrains Kotlin / Neovim Lua rewrites  
- Replacing `node:test` with `@effect/vitest` before Phase 6  
- Full `Layer` DI rewrite of `src/pi/index.ts`  
- On-wire protocol or lock-file JSON shape changes  
- Mock modes / fake data paths for Effect demos  

## Related

- Architecture: `docs/explanation/architecture.md`  
- Protocol: `docs/specs/ide-protocol.md`  
- Supersedes monolithic draft: removed in favor of this directory  
