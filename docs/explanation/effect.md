# Effect adoption

Pi × IDE uses [Effect](https://effect.website/) as an **implementation detail**
for typed failures, Schema validation, and composable async work on the Pi side.
Public APIs that VS Code, tests, and Pi host callbacks call stay Promise- or
sync-friendly. This page is for contributors who touch `src/shared/*` or
`src/pi/*`.

## Why Effect here

- **Structured errors** — tagged failures (`LockFileParseError`, connect/install
  errors) carry fields without free-form string parsing.
- **Schema decode** — lock files, selections, and diagnostic payloads share one
  validation path (`effect-schema` → `schema.ts` adapters).
- **Boundary control** — IO programs (discovery, host resolve, install, connect,
  reconnect, Zed poll) can fail closed or log-and-swallow at process edges.

Effect is not a product feature. End users never configure it.

## Boundary rule

- **Never** throw Effect failures into Pi host callbacks or VS Code activation.
- Exit Effects with `Effect.runPromise` / `Effect.runSync`, Phase 1 runners
  (`runEffect` / `runEffectSync`), or Pi helpers (`runPiEffect`).
- On failure at a Pi boundary: report via `logExtensionError` / `containPiError`
  (pi `ui.notify`, not `console`); optionally set `runtime.connectionStatus = "error"`.
- **Interrupt** (reconnect / Zed poll fibers) is cancellation, not a UI error.

Auth tokens stay in WebSocket upgrade headers only. Do not put `authToken` or
full lock JSON into logs, Effect error messages, or `scope` strings.

## Module map

| Module                                                                                                     | Role                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `src/shared/effect-errors.ts`                                                                              | `Data.TaggedError` domain errors with readable `message` getters                                                       |
| `src/shared/effect-runtime.ts`                                                                             | `runEffect` / `runEffectSync` (log-and-swallow); `runEffectOrThrow` (tests)                                            |
| `src/shared/effect-schema.ts`                                                                              | Effect Schema definitions + `decode*` helpers                                                                          |
| `src/shared/schema.ts`                                                                                     | Stable `is*` / `parse*` facades over Schema decode                                                                     |
| `src/shared/jsonrpc-guard.ts`                                                                              | Effect-free `isJsonRpcRequest` for the VS Code `ide-server` import graph                                               |
| `src/pi/index.ts`, `commands.ts`, `context.ts`, `ui.ts`, `state.ts`, `safety.ts`, `diagnostic-renderer.ts` | Lightweight static shell: registration, status UI, local diagnostic renderer, error containment (no Effect, no pi-tui) |
| `src/pi/config-ui.ts`                                                                                      | Settings dialog (pi-tui); loaded only via dynamic import from `/ide settings`                                          |
| `src/pi/runtime-loader.ts`                                                                                 | Heavy-runtime dynamic boundary: cached `import("./runtime-services.js")`                                               |
| `src/pi/runtime-services.ts`                                                                               | Heavy lifecycle: discovery/install/connect/reconnect/Zed (may import Effect)                                           |
| `src/pi/effect-boundary.ts`                                                                                | `runPiEffect` → `containPiError` + UI status (Effect runtime import)                                                   |
| `src/pi/safety.ts`                                                                                         | Effect-free `containPiError`, `runPiBoundary`, `runPiBoundaryAsync`                                                    |
| `src/pi/discovery.ts`, `ide-host.ts`, `install.ts`                                                         | Effect programs + Promise facades                                                                                      |
| `src/pi/connection.ts`                                                                                     | Connect handshake Effect; maps tagged timeout → `IdeConnectionTimeoutError`                                            |
| `src/pi/reconnect.ts`, `zed.ts`                                                                            | Interruptible fibers for reconnect delay and Zed poll                                                                  |

VS Code still imports `@shared/*` pieces that must stay Effect-free on the hot
path (`jsonrpc-guard`, protocol, lock-file helpers). Pulling `effect-schema` into
the VS Code bundle is an escape-hatch failure: keep decode on the Pi path or
split guards if bundle size grows.

### Pi startup shell vs heavy runtime

- The published Pi entry is an esbuild code-split ESM shell (`dist/src/pi/index.js`)
  with Effect/`ws`/`node:sqlite` only on **dynamic-import** edges into lazy chunks.
- `runtime-loader.ts` is the only dynamic boundary for the heavy lifecycle
  (`runtime-services.ts`). `effect-boundary.ts` may import Effect; the static
  shell must not.
- `/ide settings` is a second lazy boundary: `commands.ts` dynamically imports
  `config-ui.ts` only when the settings subcommand runs. That keeps `pi-tui`
  (SettingsList and friends) out of the static shell graph. Because the lazy
  chunk bundles its own pi-tui code, it seeds that copy with the keybinding
  manager injected by `ctx.ui.custom()` so user remappings still apply.
- The diagnostic message renderer is a **local** Component-shaped helper
  (`render` / `invalidate`) so the shell never takes a runtime edge into
  `@earendil-works/pi-tui`. Config UI uses a local `DynamicBorder` for the same
  reason — no coding-agent value import for borders.
- **Host package runtime edge ban:** every generated Pi entry JS output (static
  entry and lazy chunks) must have **zero** runtime external imports of
  `@earendil-works/pi-coding-agent` or `@earendil-works/pi-tui`. Type-only imports
  are fine; value imports of host packages in native ESM bypass Pi's jiti aliases
  and can double-load host copies. The bundler metafile gate fails the build on
  any remaining host external edge. `pi-tui` is bundled into the settings lazy
  chunk; coding-agent stays listed as esbuild `external` for future checks but
  must not appear as a runtime edge in outputs.
- Adding a static Effect, heavy-runtime, or host-package value import to the
  shell is a **startup regression**. Topology/size gates fail the build if the
  static entry gains a heavy static dependency or if any output reintroduces a
  host runtime external edge.

## Import style

Prefer Effect subpath imports for tree-shaking:

```ts
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Data from "effect/Data";
import * as Fiber from "effect/Fiber";
```

## Error tagging

- Use tags listed in `effect-errors.ts` (or add a tag in the phase that needs it).
- Override `message` so default logging is useful without dumping secrets.
- Promise facades that existing code checks with `instanceof` (e.g.
  `IdeConnectionTimeoutError`) must map tagged failures back to those classes.

## What stays Promise / sync based

- Exported discovery, install, connect, and host-resolve entry points.
- `IdeConnection` class methods and callback model.
- VS Code extension activation and shared IDE host WebSocket server.
- Pure helpers: ranking, version compare, path matching, Zed snapshot SQL.

Call sites in the heavy runtime (`runtime-services.ts` and deeper) should keep
using Promise facades unless a path explicitly opts into `runPiEffect` from
`effect-boundary.ts`. The lightweight shell must not import `effect-boundary.ts`
or Effect modules.

## Non-goals

- Full `Layer` DI rewrite of the extension entrypoint.
- JetBrains Kotlin / Neovim Lua rewrites.
- Replacing `node:test` with `@effect/vitest` as a requirement.
- On-wire protocol or lock-file JSON shape changes.
- Mock modes or fake Effect data paths.

## Related

- [Architecture](architecture.md) — process roles and data flow.
- [How discovery works](discovery.md) — lock ranking (behavior unchanged by Effect).
- Implementation plans: [effect-adoption-plan](../plans/effect-adoption-plan/).
