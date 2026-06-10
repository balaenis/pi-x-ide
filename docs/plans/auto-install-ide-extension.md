# Implementation Plan

## Goal

Implement Marketplace-based auto-install/update of the `balaenis.pi-x-ide` IDE extension on Pi startup, plus a manual `/ide install` command, without blocking startup or changing the existing lock-file connection protocol.

## Tasks

1. **Add runtime state for install coordination and session guards**: Track install concurrency and prevent install retry work from reconnecting after session shutdown or `/ide off`.
   - File: `src/pi/state.ts`
   - Changes:
     - Add `installingIdeIds: Set<string>` to `PiIdeRuntime` for per-runtime install de-duplication.
     - Add `sessionGeneration: number` to `PiIdeRuntime`.
     - Initialize both in `createRuntime()`.
   - Acceptance: `pnpm typecheck` passes and existing runtime callers compile without changes beyond the planned index/install updates.

2. **Create the IDE extension install module**: Implement CLI discovery, environment gating, installed-version detection, version comparison, install execution, and auto-candidate selection.
   - File: `src/pi/install.ts`
   - Changes:
     - Export constants:
       - `PI_X_IDE_EXTENSION_ID = "balaenis.pi-x-ide"`
       - `PI_X_IDE_AUTO_INSTALL_ENV = "PI_X_IDE_AUTO_INSTALL"`
       - supported CLI profiles for VS Code (`code`), Cursor (`cursor`), and Windsurf (`windsurf`).
     - Import the target version from root `package.json` rather than `vscode/package.json`.
     - Add types similar to the spec:
       - `IdeInstallCandidate`
       - `IdeInstallResult`
       - `IdeInstallReason = "missing" | "outdated" | "current" | "unknown"`
     - Implement pure helpers:
       - `isAutoInstallEnabled(env = process.env)` where `0`, `false`, and `off` disable auto-install case-insensitively.
       - `parseInstalledExtensionVersion(output, extensionId)` for `--list-extensions --show-versions` output lines like `balaenis.pi-x-ide@1.0.5`.
       - `compareExtensionVersions(installed, target)` with no new dependency; compare stable semver `major.minor.patch`, treat installed versions greater than target as current, and return an unknown result for unparsable versions.
       - `inferCurrentIdeFromEnv(env)` conservatively returns `"windsurf"`, `"cursor"`, `"vscode"`, or `undefined`; check Windsurf/Cursor markers before generic VS Code markers, and return `undefined` when ambiguous.
       - `buildInstallArgs()` returns `["--force", "--install-extension", PI_X_IDE_EXTENSION_ID]`.
     - Implement async helpers:
       - `findExecutable(command, env)` by searching `PATH` manually; on Windows also honor `PATHEXT`.
       - `runCli(cliPath, args, timeoutMs)` using `execFile` or `spawn`, not shell string concatenation.
       - `discoverInstallCandidates({ env, includeLowConfidence })` to find available CLIs, run `--list-extensions --show-versions`, and mark each candidate as missing/outdated/current/unknown.
       - `selectAutoInstallCandidate(candidates, env)` to return only a single high-confidence current-terminal candidate; return `undefined` for none or ambiguous matches.
       - `installIdeExtension(candidate, runtime, options)` to run the install only when needed, de-dupe by `runtime.installingIdeIds`, use a 60s timeout, and return a result object with stdout/stderr/error details.
   - Acceptance:
     - No shell-based command construction is used for install/list operations.
     - Missing, outdated, current, and unknown installed-version states are represented explicitly.
     - `pnpm typecheck` passes.

3. **Add focused unit tests for install helpers**: Cover pure behavior before wiring it into the Pi lifecycle.
   - File: `test/install.test.ts`
   - Changes:
     - Test `isAutoInstallEnabled()` for unset, `0`, `false`, `off`, and enabled values.
     - Test `parseInstalledExtensionVersion()` with multiple extension lines and `balaenis.pi-x-ide@<version>`.
     - Test `compareExtensionVersions()` for lower/equal/higher versions and unparsable versions.
     - Test `inferCurrentIdeFromEnv()` for VS Code, Cursor, Windsurf, and ambiguous env maps.
     - Test `selectAutoInstallCandidate()` only chooses one high-confidence candidate and skips ambiguous/low-confidence cases.
     - Test `buildInstallArgs()` equals `["--force", "--install-extension", "balaenis.pi-x-ide"]`.
   - Acceptance: `pnpm test` runs the new compiled `dist/test/install.test.js` and all tests pass.

4. **Wire startup auto-install without blocking session startup**: Run install detection asynchronously alongside the existing auto-connect path.
   - File: `src/pi/index.ts`
   - Changes:
     - Import auto-install helpers from `./install`.
     - Increment `runtime.sessionGeneration` on `session_start` and `session_shutdown`.
     - On `session_start`, after handling disabled runtime state, start a fire-and-forget `maybeAutoInstallAndReconnect(runtime, ctx, generation)` before or alongside the existing `connectAuto(runtime, ctx)` call.
     - `maybeAutoInstallAndReconnect` should:
       - Return immediately if `isAutoInstallEnabled()` is false.
       - Discover install candidates for auto mode.
       - Use `selectAutoInstallCandidate()`; if no high-confidence single target exists, skip without prompting.
       - Notify lightly when installing/updating starts and when it succeeds/fails, only if `ctx.hasUI`.
       - Call `installIdeExtension()` only when `needsInstall` is true; if current, do not reinstall.
       - After success, retry lock discovery/connect for up to ~10-15 seconds using the current `connectAuto()` path.
       - Before each retry or notification, verify `runtime.sessionGeneration === generation` and `runtime.enabled` so `/ide off` and shutdown are respected.
       - If install succeeds but no lock file appears, show the reload guidance from the spec.
     - Do not block or fail Pi startup when auto-install errors.
   - Acceptance:
     - Startup still connects to existing lock files as before.
     - Auto-install failures surface as warnings but do not throw out of the `session_start` handler.
     - `/ide off` prevents a later auto-install retry from reconnecting.

5. **Add manual `/ide install` command support**: Let users choose a supported IDE CLI and install/update explicitly.
   - File: `src/pi/commands.ts`
   - Changes:
     - Extend `IdeCommandActions` with `installExtension: (ctx: ExtensionCommandContext) => Promise<void>`.
     - Add `install` to completions and usage text.
     - Add `case "install"` in the command handler.
     - Implement a local `installExtension(actions, ctx)` wrapper or call the action directly.
   - File: `src/pi/index.ts`
   - Changes:
     - Pass an `installExtension` action to `registerIdeCommand()`.
     - Implement the action to:
       - Discover manual install candidates with `includeLowConfidence: true`.
       - Show a warning if no supported CLI is available.
       - Build labels showing IDE label, CLI path, installed version or missing status, target version, and whether install/update is required.
       - Use `ctx.ui.select()` when multiple candidates exist.
       - If the selected candidate is current, notify that it is up to date and run one `connectAuto()` attempt.
       - If missing/outdated/unknown, run `installIdeExtension()` with manual mode, notify success/failure, set `runtime.enabled = true`, and retry connection using the same bounded retry helper from startup.
   - Acceptance:
     - `/ide install` appears in completions.
     - `/ide install` does not require an existing lock file.
     - Manual install can run even when `PI_X_IDE_AUTO_INSTALL=0` is set.

6. **Keep current connection discovery unchanged**: Ensure auto-install remains additive and does not alter lock-file selection behavior.
   - File: `src/pi/discovery.ts`
   - Changes: No functional change expected; only import/use it from retry helpers if needed.
   - Acceptance: Existing `discovers and sorts matching lock files` test remains unchanged and passes.

7. **Document the new behavior in English README**: Explain auto-install, the disable environment variable, and manual command.
   - File: `README.md`
   - Changes:
     - Add a short section near “Connecting to Pi” explaining that Pi attempts to auto-install/update `balaenis.pi-x-ide` when launched from a supported VS Code-family integrated terminal.
     - Document `PI_X_IDE_AUTO_INSTALL=0`.
     - Add `/ide install` to the command reference table.
     - Note that users may need to reload the IDE window if the extension installs successfully but no lock file appears.
   - Acceptance: README accurately reflects Marketplace-ID install, not bundled VSIX install.

8. **Document the new behavior in Chinese README**: Mirror the English README changes.
   - File: `README.zh.md`
   - Changes:
     - Add the same auto-install/update behavior in Chinese.
     - Document `PI_X_IDE_AUTO_INSTALL=0`.
     - Add `/ide install` to the command reference table.
     - Include reload guidance.
   - Acceptance: README.zh.md stays consistent with README.md.

9. **Update or add tests for command wiring where practical**: Validate the new command branch without over-mocking the Pi runtime.
   - File: `test/install.test.ts` or `test/shared.test.ts`
   - Changes:
     - If `registerIdeCommand` can be tested with a small fake `ExtensionAPI`, add a test that completions include `install` and the handler calls the `installExtension` action for `/ide install`.
     - If the Pi command API shape makes this brittle, leave command behavior for manual validation and rely on typecheck plus install-helper tests.
   - Acceptance: Either command wiring has a focused unit test, or the implementation notes/manual validation clearly cover it.

10. **Run validation and fix issues**: Confirm the feature compiles, formats, and does not regress existing behavior.
    - File: project root scripts
    - Changes: None expected.
    - Acceptance:
      - `pnpm typecheck` passes.
      - `pnpm test` passes.
      - `pnpm format:check` passes after formatting touched files.
      - `pnpm lint` passes or any pre-existing lint failures are documented.

11. **Manual validation in real IDEs**: Verify the integration behavior that cannot be proven by unit tests.
    - File: N/A
    - Changes: N/A
    - Acceptance:
      - From a VS Code integrated terminal with the extension missing, start Pi and confirm auto-install starts asynchronously and eventually connects or shows reload guidance.
      - With `PI_X_IDE_AUTO_INSTALL=0`, start Pi and confirm no auto-install runs.
      - Run `/ide install` and confirm the selectable target list includes available `code`/`cursor`/`windsurf` CLIs with version status.
      - Confirm an up-to-date install is not force-reinstalled.
      - Confirm an older install invokes `<cli> --force --install-extension balaenis.pi-x-ide`.

## Files to Modify

- `src/pi/state.ts` - add install in-flight tracking and session generation guards.
- `src/pi/install.ts` - new install/discovery/version/helper module.
- `src/pi/index.ts` - wire startup auto-install, bounded reconnect retry, and manual install action.
- `src/pi/commands.ts` - add `/ide install` completion, usage, and handler branch.
- `test/install.test.ts` - focused unit tests for install helper behavior and optionally command wiring.
- `README.md` - document auto-install, disable env var, reload guidance, and `/ide install`.
- `README.zh.md` - Chinese documentation matching README.md.

## New Files

- `src/pi/install.ts` - IDE CLI discovery, extension version detection, install execution, and auto/manual candidate selection.
- `test/install.test.ts` - unit tests for install parsing, version comparison, env gating, env inference, auto candidate selection, and install args.

## Dependencies

- Task 1 must happen before Tasks 2, 4, and 5 because install de-duplication and session guards rely on runtime state.
- Task 2 must happen before Tasks 3, 4, and 5 because startup/manual flows consume install helpers.
- Task 3 can run after Task 2 and before lifecycle wiring to catch helper mistakes early.
- Task 4 depends on Tasks 1 and 2.
- Task 5 depends on Tasks 1 and 2, and should reuse the bounded retry helper from Task 4.
- Tasks 7 and 8 should happen after command names/env var behavior are finalized in Tasks 4 and 5.
- Task 10 depends on all code and docs changes.
- Task 11 depends on a successful local build and at least VS Code CLI availability.

## Risks

- Current-terminal detection for Cursor and Windsurf is inherently uncertain because their integrated terminals may expose generic VS Code environment variables. Keep auto-install conservative: skip if ambiguous and require `/ide install`.
- Cursor/Windsurf CLI support for `--force`, `--list-extensions --show-versions`, and Marketplace/Open VSX source resolution must be manually validated on real installations.
- Freshly CLI-installed extensions may not activate in an already-running IDE window; bounded retry plus reload guidance is required.
- Importing root `package.json` for the target version must be verified in both source and compiled `dist` execution. If `tsc` does not emit the needed JSON path, replace with a small generated/static package-info module.
- The existing VS Code extension lock file currently reports `ide: "vscode"` and `name: "Visual Studio Code"` even if installed into a VS Code-compatible IDE. This plan does not change the lock-file protocol; if accurate Cursor/Windsurf display names are required, that should be a separate protocol/extension task.
- Avoid adding a `semver` dependency unless the minimal comparator proves insufficient; if a dependency is added, update `package.json`/lockfile and use the latest stable version per project instructions.
