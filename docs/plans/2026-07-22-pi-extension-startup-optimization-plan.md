# Pi Extension Startup Optimization Implementation Plan

**Goal:** Reduce `pi-x-ide` extension import latency by keeping the Pi entry shell Effect-free, preloading the heavy runtime without blocking extension registration, and publishing a code-split ESM bundle that avoids jiti traversing hundreds of dependency files.

**Inputs:** User request to optimize `pi-x-ide` startup; source under `src/pi/*` and `src/shared/*`; Effect architecture documented in `docs/explanation/effect.md`; automated compatibility floor `@earendil-works/pi-coding-agent` 0.80.1 from this repository and target host 0.81.1 from the user's installed Pi; local measurements on Windows showing a 7,764 ms cold `pi-x-ide` module import in the full 0.81.1 extension set, a ~1,308 ms isolated fresh-process import for the current unbundled npm entry, and a 653 KB temporary unminified bundle importing in ~997 ms under the same isolated harness.

**Assumptions:**

- Keep Effect 3.22 as the implementation for Schema validation, typed failures, connection workflows, reconnect, and Zed polling.
- Preserve current startup semantics: `session_start` still waits for discovery/connect before completing; auto-install/reconnect-after-install remains fire-and-forget and must not extend `session_start` completion.
- Start the cached heavy-runtime import during extension factory execution but do not await it there. This allows it to overlap later extension imports while `session_start` and commands await the same promise.
- Keep `effect` and `ws` in `dependencies` for this change. Dependency reclassification can follow only after the published artifact proves it no longer requires runtime resolution.
- Keep the Pi host packages external in the static entry only: `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` must resolve to the host instances. Lazy chunks must contain zero runtime import edges to those packages because native `import()` does not inherit Pi's jiti aliases.
- Publish the unminified Pi entry without a source map in the first implementation; remove the stale TypeScript-generated entry map before packaging.
- No user-facing configuration, protocol, lock-file, auth-header, IDE plugin, or selection-context behavior changes.

**Architecture:** Replace the current eager `src/pi/index.ts` graph with a lightweight extension shell and a cached dynamic runtime boundary. The shell registers commands, context handlers, renderers, and lifecycle callbacks; a new loader starts one `import("./runtime-services.js")` promise during factory execution, and every lifecycle/action path reuses it. The build keeps TypeScript compilation for types/tests and adds an esbuild ESM code-splitting pass for the Pi entry: the static entry may externalize Pi host packages, while lazy chunks bundle Effect, `ws`, project modules, and any host-package value dependency so native chunk imports never rely on jiti aliases.

**Tech Stack:** TypeScript 6, Node 26 ESM, Effect 3.22, esbuild 0.28, `ws` 8, Pi extension API, Node test runner, Bun, mise.

---

## Evidence and Constraints

- `src/pi/index.ts` currently has value imports for `discovery`, `connection`, `install`, `reconnect`, and `zed`; its runtime graph reaches 30 local modules plus `effect/Effect`, `effect/Schema`, `effect/Fiber`, `effect/Cause`, `effect/Exit`, `effect/Data`, `effect/Either`, `ws`, and `node:sqlite`.
- Cold `import("effect")` from the installed npm package measured ~3.2 seconds on the target Windows machine. `ws` and `node:sqlite` were comparatively negligible.
- The published npm entry is unbundled TypeScript output. Pi loads it through jiti, so cold startup pays filesystem resolution and transform costs across the Effect graph.
- A temporary esbuild bundle of the published entry was 653 KB unminified (273 KB minified). This proves a focused Pi bundle is practical, but bundling alone is not the final design because the initial entry would still parse Effect.
- `runPiEffect` is the only production export that forces `src/pi/safety.ts` to import `src/shared/effect-runtime.ts`; production call sites use the Promise facades instead. Splitting this helper is required to keep command/context registration Effect-free.
- The VS Code shared hot path must remain Effect-free as documented in `docs/explanation/effect.md`.

## Non-goals

- Removing Effect or replacing Effect Schema with hand-written validators.
- Changing auto-install, connection retry, Zed polling, selection attachment, or diagnostics behavior.
- Converting Pi lifecycle callbacks to background connection tasks.
- Rewriting VS Code, Neovim, or JetBrains integrations.
- Minifying the published Pi entry in the first implementation. Source-level stack readability takes priority unless benchmarks show minification is required.
- Changing Pi's global extension loader or jiti cache policy.

## File Map

- Create: `src/pi/effect-boundary.ts` — Effect-specific `runPiEffect` helper, separated from lightweight callback safety helpers.
- Create: `src/pi/runtime-loader.ts` — cached dynamic import for the heavy runtime-services module.
- Create: `src/pi/runtime-services.ts` — IDE discovery/install/connect/reconnect/Zed lifecycle and command action implementation extracted from the current entry.
- Create: `scripts/build-pi-entry.mjs` — esbuild code-splitting pass for the Pi entry with host externals and output topology checks.
- Create: `scripts/benchmark-pi-entry.mjs` — fresh-process benchmark using Pi's real extension loader and reporting median/min/max import+factory timings.
- Create: `scripts/smoke-packed-pi-entry.mjs` — pack/extract smoke that verifies the final package entry and every lazy chunk load through Pi's loader.
- Create: `test/pi-entry.test.ts` — lightweight-shell registration, cached loader, async action, and lifecycle behavior coverage.
- Modify: `src/pi/index.ts` — lightweight factory wiring only; start but do not await runtime preload; await the cached runtime in lifecycle/actions.
- Modify: `src/pi/safety.ts` — retain Effect-free `containPiError`, `runPiBoundary`, and `runPiBoundaryAsync` only.
- Modify: `src/pi/commands.ts` — allow every runtime-backed command action, including disconnect, to be awaited.
- Modify: `test/connection.test.ts` — import `runPiEffect` from the new Effect-specific boundary module.
- Modify: `test/install.test.ts` — update the command action contract and assert async disconnect/install behavior.
- Modify: `.mise/tasks/compile/_default` — run the Pi entry bundler after TypeScript compilation.
- Modify: `package.json` — make `prepack` run the same Pi entry bundler after the publish TypeScript compile.
- Modify: `docs/explanation/effect.md` — document the lightweight shell, Effect runtime boundary, and bundle rule.
- Modify: `docs/zh-CN/explanation/effect.md` — keep the Chinese Effect documentation synchronized.

## Tasks

### Task 1: Add a Reproducible Pi Loader Benchmark

**Outcome:** The repository can measure the current and modified Pi extension entry through the same loader Pi uses, with each sample running in a fresh process.

**Files:**

- Create: `scripts/benchmark-pi-entry.mjs`

**Steps:**

- [ ] Implement a parent/worker script with these CLI options:
  - `--entry <path>`: required entry file; resolve to an absolute path.
  - `--runs <count>`: default `7`; reject non-integer values below `3`.
  - `--worker`: internal mode used only by spawned child processes.
- [ ] In worker mode, import `loadExtensions` from `@earendil-works/pi-coding-agent`, measure strictly around `loadExtensions([entry], process.cwd())`, fail if `errors` is non-empty, print one JSON object containing elapsed milliseconds, and call `process.exit(0)` immediately after stdout flush. The factory preload promise must not extend the measured import+factory interval or keep the worker alive.
- [ ] In parent mode, spawn `process.execPath` once per run, collect worker JSON, and print the entry path, run count, median, minimum, and maximum. Do not reuse a process between samples because ESM/Effect caches would invalidate the benchmark.
- [ ] Exit non-zero on a worker error, invalid JSON, extension load error, or missing entry.
- [ ] Record the pre-change baseline in the implementation PR description using both the local built entry and the currently installed npm entry. Do not commit machine-specific timing numbers as an acceptance fixture.

**Validation:**

- Run: `node scripts/benchmark-pi-entry.mjs --entry ./dist/src/pi/index.js --runs 7`
- Expected: seven successful fresh-process samples and a median/min/max summary; no extension load errors.
- Run: `node scripts/benchmark-pi-entry.mjs --entry ./missing.js --runs 3`
- Expected: non-zero exit with a concise missing-entry error.

### Task 2: Separate the Effect Boundary from Lightweight Safety Helpers

**Outcome:** Importing `src/pi/safety.ts` no longer reaches `effect/*`, `src/shared/effect-runtime.ts`, Schema validators, connection code, or Zed code.

**Files:**

- Create: `src/pi/effect-boundary.ts`
- Modify: `src/pi/safety.ts`
- Modify: `test/connection.test.ts`
- Modify: `docs/explanation/effect.md`
- Modify: `docs/zh-CN/explanation/effect.md`

**Steps:**

- [ ] Move `runPiEffect` and its Effect/runtime imports from `src/pi/safety.ts` into `src/pi/effect-boundary.ts`.
- [ ] Keep `containPiError` reusable by importing it from `safety.ts`; do not duplicate error/status/UI handling.
- [ ] Leave `safety.ts` with only `containPiError`, `runPiBoundary`, and `runPiBoundaryAsync` and their lightweight dependencies.
- [ ] Update `test/connection.test.ts` to import `runPiEffect` from `effect-boundary.ts`; preserve the existing success/failure assertions.
- [ ] Update both Effect explanation documents so the module map states that `safety.ts` is Effect-free and `effect-boundary.ts` owns `runPiEffect`.
- [ ] Add an import-topology assertion to `test/pi-entry.test.ts` in Task 4 rather than using source-text grep in production code.

**Validation:**

- Run: `mise run typecheck`
- Expected: no TypeScript errors and no public Promise facade changes.
- Run: `mise run test`
- Expected: all existing Effect boundary and connection tests pass.

### Task 3: Extract the Heavy Runtime Behind One Cached Dynamic Import

**Outcome:** `src/pi/index.ts` statically imports only the lightweight registration/state/UI graph; all discovery/install/connect/reconnect/Zed/Effect modules are reached through one cached dynamic import.

**Files:**

- Create: `src/pi/runtime-loader.ts`
- Create: `src/pi/runtime-services.ts`
- Modify: `src/pi/index.ts`
- Modify: `src/pi/commands.ts`
- Modify: `test/install.test.ts`
- Test: `test/pi-entry.test.ts`

**Steps:**

- [ ] Extract the current runtime implementation from `src/pi/index.ts` into `runtime-services.ts`, including:
  - session startup/shutdown;
  - auto-install and reconnect-after-install;
  - candidate refresh and automatic/manual connect;
  - `IdeConnection` creation and callbacks;
  - disconnect, retry scheduling, diagnostics, selection, and at-mention handling.
- [ ] Export a narrow service surface from `runtime-services.ts`:
  - `startSession(pi, runtime, ctx): Promise<void>`;
  - `shutdownSession(runtime, ctx): Promise<void>` (it may resolve immediately after synchronous cleanup);
  - `refreshCandidates(runtime, ctx): Promise<LockFileCandidate[]>`;
  - `connectAuto(runtime, ctx): Promise<void>`;
  - `connectCandidate(runtime, candidate, ctx): Promise<void>`;
  - `disconnect(runtime, ctx, disabled?): Promise<void>`;
  - `installExtension(runtime, ctx): Promise<void>`.
- [ ] Keep `activePi` inside `runtime-services.ts` only if callback handling still requires it; prefer passing `pi` explicitly to `startSession` and action functions. Do not introduce a second mutable runtime singleton.
- [ ] In `runtime-loader.ts`, define `RuntimeServicesModule = typeof import("./runtime-services.js")`, cache one module promise, and export `preloadRuntimeServices()` / `loadRuntimeServices()` that return the same promise. A failed import must clear the cache so a later explicit command can retry.
- [ ] In the extension factory, call `preloadRuntimeServices()` without awaiting it and attach a rejection handler that logs through the existing extension error path. Do not let an unhandled rejection escape.
- [ ] Define “session startup has begun” as entry into the `session_start` handler, not factory preload. Before the first await in that handler: increment `runtime.sessionGeneration`, capture the generation, assign `ctx`/`cwd`, and mark an explicit `runtime.sessionStarting` flag or startup task.
- [ ] After `await loadRuntimeServices()` and before any discovery/connect side effect, re-check the captured generation. `startSession` must continue checking it after awaited discovery/connect boundaries using the existing current-session rules.
- [ ] Make `session_start` await `startSession` so current discovery/connect readiness semantics are preserved, but keep `maybeAutoInstallAndReconnect` fire-and-forget exactly as today. Add a regression test proving `session_start` resolves while a deliberately pending auto-install task remains unresolved.
- [ ] On `session_shutdown`, increment the generation before any await, clear the session-starting marker, then await the in-flight module/startup task when a session start, live connection, or reconnect/Zed fiber may exist. Run `shutdownSession` after load and ensure a stale `startSession` cannot reconnect afterward.
- [ ] Wrap command action closures around `loadRuntimeServices()` and call the matching service. Change `IdeCommandActions.disconnect` from `void` to `Promise<void>` and await it in every command handler branch. Document that an early `/ide off` or disconnect may wait for the already-started heavy preload; it must still reuse one promise and remain cancel-safe.
- [ ] Keep command completion, settings UI, attach shortcut registration, context hooks, diagnostic renderer registration, and lightweight status rendering available before the heavy module resolves.
- [ ] Preserve all existing error strings, reconnect limits, install notifications, connection callbacks, and generation checks while moving code.

**Validation:**

- Run: `mise run typecheck`
- Expected: no TypeScript errors; `IdeCommandActions` implementations are consistently async.
- Run: `mise run test`
- Expected: all existing install, connection, diagnostics, shared, and Zed tests pass.

### Task 4: Test the Lightweight Shell and Loader Lifecycle

**Outcome:** Automated tests prevent regressions that reintroduce Effect into the static entry graph or create duplicate runtime loads/actions.

**Files:**

- Create: `test/pi-entry.test.ts`
- Modify: `test/install.test.ts`

**Steps:**

- [ ] Build a minimal fake `ExtensionAPI` that captures registered commands, shortcuts, renderers, and lifecycle callbacks without introducing a mock runtime mode in application code.
- [ ] Test that the factory registers commands/context/renderers synchronously before the runtime-services promise settles.
- [ ] Test that repeated `loadRuntimeServices()` calls return the same promise and that a failed dynamic import clears the cache. If deterministic failure injection is needed, expose an internal loader factory parameter used only by tests; do not add an environment-controlled mock path.
- [ ] Test that `session_start` bumps/captures the generation before runtime loading, re-checks after load, and calls `startSession` once with the current generation/context.
- [ ] Test that `session_start` resolves after discovery/connect while a deliberately pending auto-install/reconnect-after-install task remains unresolved.
- [ ] Test that `session_shutdown` bumps generation before awaiting a delayed module/startup task, invokes cleanup, and prevents delayed startup from reconnecting.
- [ ] Test that `/ide disconnect` awaits the async action before the command handler resolves, including the case where heavy preload is still pending.
- [ ] Add a build-artifact topology check in `scripts/build-pi-entry.mjs` (Task 5): the initial entry output must have no static imports of chunks containing `effect/*`, `ws`, or `node:sqlite`; those imports must be `dynamic-import` edges only.

**Validation:**

- Run: `mise run test`
- Expected: new entry/lifecycle tests pass alongside the existing suite.

### Task 5: Publish a Code-Split Pi Entry Bundle

**Outcome:** `dist/src/pi/index.js` is a small ESM shell, while the heavy runtime and Effect graph are bundled into hashed lazy chunks; Pi host modules remain external.

**Files:**

- Create: `scripts/build-pi-entry.mjs`
- Create: `scripts/smoke-packed-pi-entry.mjs`
- Modify: `.mise/tasks/compile/_default`
- Modify: `package.json`

**Steps:**

- [ ] Implement `scripts/build-pi-entry.mjs` with esbuild's JavaScript API and these fixed settings:
  - entry point: `src/pi/index.ts`;
  - `bundle: true`, `splitting: true`, `format: "esm"`, `platform: "node"`, `target: "node26"`;
  - output directory: `dist/src/pi`;
  - `entryNames: "index"`, `chunkNames: "chunks/[name]-[hash]"`;
  - external in the static entry: `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`;
  - bundle `effect`, `ws`, and project-local modules; leave Node built-ins external through the Node platform setting;
  - no minification and no source map in the first implementation;
  - `metafile: true` for in-process validation, not as a shipped file.
- [ ] Before building, remove only the prior generated `dist/src/pi/index.js`, the stale TypeScript-generated `dist/src/pi/index.js.map`, and `dist/src/pi/chunks/`. Do not delete declarations or unrelated `dist/src/shared`, test, or IDE outputs.
- [ ] Validate the metafile after build using resolved metafile input/output paths, not source-text scans:
  - the initial `index.js` has no static dependency edge to an output whose inputs include `effect/*`, `ws`, or `node:sqlite` users;
  - the static entry may import Pi host packages as external edges;
  - every lazy chunk has zero external import edges to either Pi host package; move/inline any required value dependency into the static shell or bundle it into the lazy chunk;
  - the initial entry is at most 100 KB unminified;
  - all Pi entry JS outputs together are at most 1.5 MB.
- [ ] Fail the build with actionable output if topology or size limits are exceeded.
- [ ] Update `.mise/tasks/compile/_default` to run `bunx tsc -p tsconfig.json` followed by `bun run scripts/build-pi-entry.mjs`.
- [ ] Update `prepack` to run the publish TypeScript compile and then the same bundle script so local builds and npm artifacts cannot diverge.
- [ ] Keep `package.json` `main` and `pi.extensions` pointing to `./dist/src/pi/index.js`; hashed chunks remain under the already included `dist/src` package path.
- [ ] Implement `scripts/smoke-packed-pi-entry.mjs` to create a temporary pack directory, run `bun pm pack`, extract the tarball, verify every entry/chunk reference exists inside `package/dist/src/pi`, native-import every generated lazy chunk to force host/dependency resolution, and load the packed entry through the repository's Pi loader. Fail on any chunk/entry/module-resolution error and always remove the temporary directory.
- [ ] Confirm test builds still exercise TypeScript modules directly; treat the packed-entry smoke and metafile topology checks as separate hard gates because unit tests do not execute esbuild chunks.
- [ ] Add the mandatory two-line `ABOUTME:` header to every new `.ts`/`.mjs` implementation or test file created by this plan.

**Validation:**

- Run: `mise run compile`
- Expected: TypeScript output plus `dist/src/pi/index.js` and `dist/src/pi/chunks/*.js`; topology/size validation passes.
- Run: `node scripts/benchmark-pi-entry.mjs --entry ./dist/src/pi/index.js --runs 7`
- Expected: median import+factory time is at least 50% lower than the Task 1 local baseline; initial module registration completes without awaiting the heavy runtime.
- Run: `node scripts/smoke-packed-pi-entry.mjs`
- Expected: packed entry and all referenced chunks exist; every lazy chunk native-imports and the entry loads through Pi without host-package resolution errors; no temporary metafile is included.

### Task 6: Verify Full Pi Startup and Document the Runtime Boundary

**Outcome:** Real Pi startup confirms the isolated benchmark, and contributor docs describe where Effect may be imported.

**Files:**

- Modify: `docs/explanation/effect.md`
- Modify: `docs/zh-CN/explanation/effect.md`

**Steps:**

- [ ] Update the EN/ZH module map and import rules:
  - `index.ts`, `commands.ts`, `context.ts`, `ui.ts`, `state.ts`, and `safety.ts` form the lightweight static shell;
  - `runtime-loader.ts` is the only dynamic boundary;
  - `runtime-services.ts` and `effect-boundary.ts` may import Effect;
  - adding a static Effect/heavy-runtime import to the shell is a startup regression.
- [ ] Treat `scripts/benchmark-pi-entry.mjs` against the repository-pinned Pi 0.80.1 loader as the automated acceptance gate. Separately run the user's installed Pi 0.81.1 with only the built local extension and `PI_TIMING=1`; capture at least three fresh launches after one warm-up using the same environment for baseline and candidate.
- [ ] On Pi 0.81.1, confirm `pi-x-ide ... module import` is at least 50% lower than the recorded full-loader baseline and factory time remains below 50 ms. Do not require per-extension timing labels from Pi 0.80.1, which does not expose the same instrumentation.
- [ ] Confirm `session_start` still waits for initial discovery/connect and that an immediately submitted prompt sees the same selected-context behavior as before.
- [ ] Verify one session each with VS Code, no IDE lock file, auto-install disabled, and Zed terminal detection. No case may produce an unhandled dynamic-import rejection.

**Validation:**

- Run: `node scripts/benchmark-pi-entry.mjs --entry ./dist/src/pi/index.js --runs 7`
- Expected: automated median import+factory time is at least 50% below the Task 1 repository-loader baseline.
- Run: `PI_TIMING=1 pi -ne -e ./dist/src/pi/index.js`
- Expected: on the target Pi 0.81.1 host, open the TUI without submitting a model request, record the extension timing, and exit; module import is at least 50% below the full-loader baseline and factory is below 50 ms.
- Run: `mise run typecheck`
- Expected: TypeScript and VS Code type checks pass.
- Run: `mise run test`
- Expected: all Node tests pass.
- Run: `mise run build`
- Expected: Pi TypeScript/bundle, VSIX, and Neovim sidecar builds pass.

## Final Validation

- Run: `mise run typecheck`
- Expected: no TypeScript or VS Code type errors.
- Run: `mise run test`
- Expected: all existing and new tests pass with no open handles or unhandled rejections.
- Run: `mise run build`
- Expected: all default artifacts build; Pi entry topology and size gates pass.
- Run: `mise run lint`
- Expected: ESLint passes.
- Run: `mise run format:check`
- Expected: Prettier/format checks pass.
- Run: `node scripts/benchmark-pi-entry.mjs --entry ./dist/src/pi/index.js --runs 7`
- Expected: median import+factory time improves by at least 50% over the recorded pre-change local baseline.
- Run: `node scripts/smoke-packed-pi-entry.mjs`
- Expected: npm tarball contains the entry and every referenced chunk, all chunks native-import successfully, and the packed entry loads without host-package import failures or a shipped build metafile.

## Failure Behavior

- Heavy runtime import fails during factory preload — log once through the extension error path, clear the cached rejected promise, keep lightweight commands/renderers registered, and allow the next `session_start` or explicit command to retry.
- Heavy runtime import fails during `session_start` — contain the error, set the runtime status to `error`, update UI through existing helpers, and do not throw into Pi.
- Auto-install is still running when awaited discovery/connect completes — let `session_start` resolve exactly as today; the background install path retains generation checks and may reconnect only if the session is still current.
- Session shuts down while the runtime chunk is loading — increment the session generation before awaiting anything; delayed startup must observe staleness and perform/queue cleanup without connecting.
- Command arrives while preload is in progress — await the same cached promise; do not start a second import or duplicate connection workflow.
- Generated chunk is missing from the package — `prepack`/topology validation fails before publication.
- Bundle topology regresses and Effect becomes a static entry dependency — build fails with the offending output/import edge.
- Benchmark target is not met — do not minify or weaken tests automatically; inspect the metafile and loader trace, then decide in a separate change whether minification or further shell splitting is warranted.

## Privacy and Security

- Preserve the existing rule that `authToken` appears only in WebSocket upgrade headers and is never logged, included in benchmark output, or embedded as build-time data.
- Dynamic import errors may include filesystem/module paths but must not include config contents, lock-file JSON, selection text, or credentials.
- Benchmark output contains only entry paths and timings; it must not initialize a model request or print environment variables.
- Bundling must not inline user config, generated lock files, local caches, or machine-specific paths.

## Rollout Notes

- Ship as a patch-level performance/build change after validating a packed tarball, because public APIs and user-visible behavior remain unchanged.
- Test the packed artifact through Pi's package installation path, not only `-e` against the repository, so dynamic chunk resolution is verified from the final package layout.
- Keep `effect` and `ws` dependencies for the first release. Consider moving them only after one published soak confirms no unbundled runtime entry requires them.
- Compare Windows cold/warm launches and at least one Linux/macOS launch; Windows is the primary acceptance platform because filesystem traversal produced the reported hotspot.
- Do not remove the existing Effect adoption plans; this plan narrows where the adopted runtime is loaded, not whether it is used.

## Risks and Mitigations

- Dynamic import only relabels cost instead of improving startup — start preload without awaiting factory and verify isolated fresh-process import+factory results plus manual Pi 0.81.1 timing; code splitting ensures the initial entry does not parse Effect.
- Lazy chunk imports Pi host packages through native `import()` — fail the metafile check if any lazy chunk has a host-package external edge, then confirm the packed artifact through Pi's loader.
- Immediate prompt loses initial IDE context — keep `session_start` awaiting the cached preload/startup workflow; do not convert connection initialization to detached background work.
- Duplicate startup/command imports create concurrent connections — cache one module promise and reuse existing generation/current-connection guards; add concurrent action tests.
- Hashed chunks are omitted from npm — keep chunks under `dist/src`, validate metafile references, and inspect `bun pm pack --dry-run`.
- Bundling creates a second Pi SDK instance — externalize both Pi host packages and assert external edges in the metafile.
- VS Code bundle gains Effect — do not change the VS Code build entry or shared hot-path imports; run the existing full build and retain the documented 10% bundle-growth guard.
- Source maps or minification obscure production stacks — do not minify initially; decide sourcemap policy explicitly in the bundler and package check.
- Existing local `dist` is stale — clean only generated Pi entry/chunks on every compile and make local/publish builds call the same bundler.

## Open Questions

**Open Questions:** None. The plan fixes host-package imports to the static jiti entry, preserves fire-and-forget auto-install plus awaited discovery/connect semantics, defines generation ordering across preload/shutdown, and publishes no Pi-entry source map in the first implementation.
