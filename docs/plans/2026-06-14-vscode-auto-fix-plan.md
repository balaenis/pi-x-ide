# VS Code Auto Fix Implementation Plan

**Goal:** Add a VS Code Quick Fix action named `Fix with Pi suggest` that sends the selected diagnostic context to Pi and automatically starts a Pi diagnostic-analysis turn.

**Inputs:** `docs/drafts/vscode_auto_fix.md`, repository evidence from `vscode/src/extension.ts`, `vscode/src/selection.ts`, `src/shared/protocol.ts`, `src/shared/schema.ts`, `src/pi/connection.ts`, `src/pi/context.ts`, `src/pi/index.ts`, `docs/specs/ide-protocol.md`, `README.md`, `README.zh-CN.md`, `vscode/README.md`, and Pi extension API evidence for `pi.sendUserMessage()` from the installed Pi documentation and examples.

**Assumptions:**

- User-editable prompt input is out of scope for this iteration, per the latest request.
- `Debug flow` means injecting a real Pi user message with `pi.sendUserMessage()`; this repository does not currently define a separate `/debug` command or debug-mode API.
- The Quick Fix should appear only for file-backed VS Code documents and only when the VS Code `CodeActionContext` contains error or warning diagnostics.
- The diagnostic payload should include diagnostics from the current Quick Fix context, not every diagnostic in the workspace.
- The protocol version can remain `1` because the new notification is additive and older clients ignore unknown notification methods.

**Architecture:** The VS Code extension will register a `CodeActionProvider` that contributes one `QuickFix` action for error/warning diagnostics, normalizes the diagnostics plus bounded source context into a shared JSON-RPC payload, and broadcasts a new `diagnostic_fix_requested` notification over the existing authenticated WebSocket. The Pi extension will validate that notification, format the diagnostic context with the draft prompt template, and call `pi.sendUserMessage()` immediately when idle or as a `followUp` when the agent is busy. Existing selection context injection must be skipped for this generated diagnostic prompt so the message contains one clear diagnostic context block.

**Tech Stack:** TypeScript, VS Code Extension API `CodeActionProvider`, existing local JSON-RPC-over-WebSocket protocol with `ws`, Pi extension API `pi.sendUserMessage()`, `node:test`, `mise`/`bun` project commands.

---

## File Map

- Create: `vscode/src/diagnostics.ts` — VS Code diagnostic Quick Fix provider, command registration, diagnostic normalization, context-line extraction, and WebSocket notification dispatch.
- Create: `src/pi/diagnostics.ts` — Pi-side prompt marker, diagnostic context formatter, prompt builder, and handler that triggers `pi.sendUserMessage()`.
- Modify: `vscode/src/extension.ts` — Register the diagnostic Quick Fix provider and command during extension activation.
- Modify: `src/shared/protocol.ts` — Add diagnostic payload types and the additive `diagnostic_fix_requested` notification shape.
- Modify: `src/shared/schema.ts` — Validate diagnostic fix request payloads received from IDE clients.
- Modify: `src/pi/connection.ts` — Parse `diagnostic_fix_requested` notifications and expose an `onDiagnosticFixRequested` callback.
- Modify: `src/pi/index.ts` — Wire the new connection callback to the Pi-side diagnostic handler.
- Modify: `src/pi/context.ts` — Recognize Pi x IDE diagnostic-context marker messages and avoid merging regular selection context into those generated prompts.
- Modify: `docs/specs/ide-protocol.md` — Document the new notification method and example payload.
- Modify: `README.md` — Document the VS Code Quick Fix workflow for users.
- Modify: `README.zh-CN.md` — Add matching Chinese documentation for the Quick Fix workflow.
- Modify: `vscode/README.md` — Update the VSIX marketplace README with the new Quick Fix feature.
- Test: `test/diagnostics.test.ts` — Cover diagnostic prompt formatting and schema validation.
- Test: `test/connection.test.ts` — Cover Pi connection dispatch of the new notification callback.

## Tasks

### Task 1: Add Diagnostic Protocol and Prompt Formatting

**Outcome:** The shared protocol can represent a VS Code diagnostic fix request, validate it at runtime, and format it into the draft diagnostic prompt template without depending on VS Code APIs.

**Files:**

- Create: `src/pi/diagnostics.ts`
- Modify: `src/shared/protocol.ts`
- Modify: `src/shared/schema.ts`
- Test: `test/diagnostics.test.ts`

**Steps:**

- [ ] In `src/shared/protocol.ts`, add `IdeDiagnosticSeverity = "error" | "warning"` because this feature intentionally filters out `information` and `hint` diagnostics.
- [ ] In `src/shared/protocol.ts`, add `IdeDiagnosticCode` as `string | number | { value: string | number; target?: string }` so VS Code diagnostic codes with documentation links are serializable.
- [ ] In `src/shared/protocol.ts`, add `DiagnosticContextLine` with `line: number`, `text: string`, and `isPrimary: boolean`; `line` must be zero-based to match the rest of the protocol.
- [ ] In `src/shared/protocol.ts`, add `IdeDiagnostic` with `severity`, `message`, optional `source`, optional `code`, `range`, `selectedText`, `contextLines`, and optional `relatedInformation` entries containing `filePath`, `range`, and `message`.
- [ ] In `src/shared/protocol.ts`, add `DiagnosticFixRequestedParams` with `source: "vscode"`, `filePath`, optional `workspaceFolder`, optional `documentVersion`, `triggerRange`, `diagnostics: IdeDiagnostic[]`, and optional `receivedAt`.
- [ ] In `src/shared/protocol.ts`, extend `IdeNotification` with `JsonRpcNotification<DiagnosticFixRequestedParams>` for the `diagnostic_fix_requested` method.
- [ ] In `src/shared/schema.ts`, add `isDiagnosticFixRequestedParams()` and helper validators for diagnostic severity, diagnostic code, diagnostic context lines, related information, and non-empty diagnostic arrays.
- [ ] In `src/pi/diagnostics.ts`, export `DIAGNOSTIC_CONTEXT_MARKER = "pi-x-ide/diagnostic-context"`.
- [ ] In `src/pi/diagnostics.ts`, implement `formatDiagnosticContext(params, { cwd })` so each diagnostic block includes relative file path when possible, severity, source, code, one-based line/column range, diagnostic message, selected text, context lines, and related information.
- [ ] In `src/pi/diagnostics.ts`, implement `buildDiagnosticFixPrompt(params, { cwd })` with this exact structure:

  ```markdown
  <!-- Diagnostic Context -->

  {Diagnostic_Context}

  <!-- Diagnostic Context -->

  Analyze the errors and warnings that appear in the above locations and provide recommendations for resolution.
  ```

- [ ] Include `<!-- pi-x-ide/diagnostic-context -->` in the generated prompt so existing editor-context injection can identify the turn as already carrying Pi x IDE context.
- [ ] Add `test/diagnostics.test.ts` cases asserting a valid payload passes `isDiagnosticFixRequestedParams()`, an empty `diagnostics` array fails validation, unsupported severities fail validation, and malformed ranges fail validation.
- [ ] Add `test/diagnostics.test.ts` cases asserting `buildDiagnosticFixPrompt()` includes the marker, relative file path, severity, diagnostic message, source/code, selected text, context lines, related information, and the exact final instruction from the draft.

**Validation:**

- Run: `mise run typecheck`
- Expected: Root TypeScript and VS Code TypeScript accept the new shared protocol types.
- Run: `mise run test`
- Expected: Existing tests pass, and `test/diagnostics.test.ts` validates the new schema and prompt formatter.

### Task 2: Contribute the VS Code Quick Fix Action

**Outcome:** VS Code-family IDEs show `Fix with Pi suggest` under Quick Fix when the current location has error or warning diagnostics, and clicking it broadcasts a bounded diagnostic context payload to connected Pi clients.

**Files:**

- Create: `vscode/src/diagnostics.ts`
- Modify: `vscode/src/extension.ts`
- Test: `test/diagnostics.test.ts`

**Steps:**

- [ ] In `vscode/src/diagnostics.ts`, define constants `FIX_WITH_PI_COMMAND = "pi-x-ide.fixWithPiSuggest"`, `FIX_WITH_PI_TITLE = "Fix with Pi suggest"`, `DIAGNOSTIC_CONTEXT_RADIUS = 2`, and `MAX_SELECTED_TEXT_CHARS = 4000`.
- [ ] Implement `registerDiagnosticQuickFixes(context, getServer)` that registers both `vscode.languages.registerCodeActionsProvider({ scheme: "file" }, provider, { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] })` and `vscode.commands.registerCommand(FIX_WITH_PI_COMMAND, handler)`.
- [ ] Implement `PiDiagnosticCodeActionProvider.provideCodeActions(document, range, context)` so it returns `[]` when `context.only` excludes `QuickFix`, when `document.uri.scheme !== "file"`, or when no diagnostics have severity `Error` or `Warning`.
- [ ] When eligible diagnostics exist, return exactly one `vscode.CodeAction` with title `Fix with Pi suggest`, kind `vscode.CodeActionKind.QuickFix`, `action.diagnostics` set to the filtered diagnostics, and `action.command.arguments` containing one normalized `DiagnosticFixRequestedParams` payload.
- [ ] Normalize VS Code severities with `Error -> "error"` and `Warning -> "warning"`; do not include `Information` or `Hint` diagnostics.
- [ ] Normalize `diagnostic.code` into `IdeDiagnosticCode`; when VS Code provides `{ value, target }`, serialize `target` as `target.toString()`.
- [ ] Normalize diagnostic ranges into zero-based `Position` objects matching `src/shared/protocol.ts`.
- [ ] Capture `selectedText` from `document.getText(diagnostic.range)` and truncate it to `MAX_SELECTED_TEXT_CHARS` with a clear suffix such as `\n...[truncated]` when needed.
- [ ] Capture `contextLines` from two lines before the diagnostic start through two lines after the diagnostic end, bounded by the document line count, with `isPrimary: true` for lines touched by the diagnostic range.
- [ ] Include `document.version`, `filePath`, `workspaceFolder`, `triggerRange`, and `receivedAt: Date.now()` in the payload.
- [ ] In the command handler, call `getServer()?.broadcast({ jsonrpc: "2.0", method: "diagnostic_fix_requested", params: payload })`.
- [ ] If the WebSocket server is not initialized, show `Pi x IDE: diagnostic fix server is not ready.` with `vscode.window.showWarningMessage()` and do not throw.
- [ ] If the server has zero connected clients, still broadcast the payload but also show `Pi x IDE: no Pi clients connected for Fix with Pi suggest.` so the user knows why no Pi turn starts.
- [ ] In `vscode/src/extension.ts`, import `registerDiagnosticQuickFixes()` and call it inside `activate()` after `server` is created, passing `() => server`.

**Validation:**

- Run: `mise run typecheck`
- Expected: VS Code extension type checking succeeds with `@types/vscode` and no implicit `any` values.
- Run: `mise run compile:vsix`
- Expected: `vscode/out/extension.js` builds successfully and includes the new diagnostic module.

### Task 3: Trigger Pi Diagnostic Flow from the New Notification

**Outcome:** Pi receives `diagnostic_fix_requested`, builds the diagnostic prompt, and automatically queues or starts an agent turn without requiring custom user input.

**Files:**

- Modify: `src/pi/connection.ts`
- Modify: `src/pi/index.ts`
- Modify: `src/pi/context.ts`
- Modify: `src/pi/diagnostics.ts`
- Test: `test/connection.test.ts`
- Test: `test/diagnostics.test.ts`

**Steps:**

- [ ] In `src/pi/connection.ts`, import `DiagnosticFixRequestedParams` and `isDiagnosticFixRequestedParams()`.
- [ ] Add `onDiagnosticFixRequested?: (params: DiagnosticFixRequestedParams) => void` to `IdeConnectionCallbacks`.
- [ ] In `IdeConnection.handleMessage()`, when `parsed.method === "diagnostic_fix_requested"` and the params pass validation, call `callbacks.onDiagnosticFixRequested(withReceivedAt(params))`.
- [ ] Generalize `withReceivedAt()` so it accepts `DiagnosticFixRequestedParams` in addition to the existing selection notification params.
- [ ] In `src/pi/diagnostics.ts`, implement `handleDiagnosticFixRequested(pi, runtime, params)` that reads `runtime.ctx`, builds the prompt with `buildDiagnosticFixPrompt(params, { cwd: ctx.cwd })`, and sends it through `pi.sendUserMessage()`.
- [ ] In `handleDiagnosticFixRequested()`, if `runtime.ctx` is missing, return without throwing because there is no active Pi session that can receive a generated user message.
- [ ] In `handleDiagnosticFixRequested()`, call `pi.sendUserMessage(prompt)` when `ctx.isIdle()` is true.
- [ ] In `handleDiagnosticFixRequested()`, call `pi.sendUserMessage(prompt, { deliverAs: "followUp" })` when `ctx.isIdle()` is false, and notify `VS Code diagnostic fix request queued.` when `ctx.hasUI` is true.
- [ ] In `src/pi/index.ts`, pass `pi` into the connection-callback factory and wire `onDiagnosticFixRequested` to `handleDiagnosticFixRequested(pi, runtime, params)` after checking `isCurrentConnection()`.
- [ ] In `src/pi/context.ts`, update the marker check so a user message containing either `pi-x-ide/editor-context` or `pi-x-ide/diagnostic-context` is treated as already carrying Pi x IDE context.
- [ ] In `src/pi/context.ts`, when a marker-bearing user message is detected during `message_end`, clear `runtime.turnSelection` before returning so the generated diagnostic prompt does not receive duplicate automatic selection context.
- [ ] Add `test/connection.test.ts` coverage with a local authenticated `WebSocketServer` that sends `diagnostic_fix_requested` after `initialize`; assert `onDiagnosticFixRequested` receives the expected message, range, severity, and `receivedAt` value.
- [ ] Add `test/diagnostics.test.ts` coverage for `handleDiagnosticFixRequested()` using a fake `ExtensionAPI` and fake `ExtensionContext`: one idle case must call `sendUserMessage(prompt)` without options, and one busy case must call `sendUserMessage(prompt, { deliverAs: "followUp" })`.

**Validation:**

- Run: `mise run test`
- Expected: New connection dispatch tests and diagnostic handler tests pass along with existing tests.
- Run: `mise run typecheck`
- Expected: The Pi extension compiles with the added callback and handler wiring.

### Task 4: Document the Quick Fix Workflow and Protocol

**Outcome:** Users and maintainers can discover the new VS Code Quick Fix behavior, understand what context is sent, and see the new protocol notification shape.

**Files:**

- Modify: `docs/specs/ide-protocol.md`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `vscode/README.md`

**Steps:**

- [ ] In `docs/specs/ide-protocol.md`, add a `diagnostic_fix_requested` notification section after `at_mentioned`.
- [ ] Document that `diagnostic_fix_requested` is sent by VS Code when the user selects `Fix with Pi suggest` from Quick Fix.
- [ ] Include an example JSON-RPC payload with `source`, `filePath`, `workspaceFolder`, `documentVersion`, `triggerRange`, `diagnostics`, `contextLines`, and `receivedAt`.
- [ ] Document that the notification is additive under protocol version `1`, and clients that do not understand it may ignore it.
- [ ] In `README.md`, add the VS Code Quick Fix workflow to the VS Code / Cursor / Windsurf usage section: place the cursor on an error/warning, open Quick Fix, choose `Fix with Pi suggest`, and Pi starts a diagnostic-analysis turn.
- [ ] In `README.md`, state that this first version uses the built-in prompt template and does not yet prompt for custom user instructions.
- [ ] In `README.zh-CN.md`, add the same Quick Fix workflow and the same custom-instruction limitation in Chinese.
- [ ] In `vscode/README.md`, add a feature bullet and usage paragraph for `Fix with Pi suggest` so the VSIX marketplace page reflects the new feature.

**Validation:**

- Run: `mise run format:check`
- Expected: Markdown and TypeScript formatting pass.
- Run: `mise run lint`
- Expected: ESLint reports no new lint errors.

### Task 5: Run End-to-End Validation

**Outcome:** The full package builds, automated checks pass, and the VS Code interaction can be manually verified against a running Pi session.

**Files:**

- Modify: `docs/plans/2026-06-14-vscode-auto-fix-plan.md` only if implementation evidence requires correcting the plan during execution.

**Steps:**

- [ ] Run the full automated validation command set after implementation: `mise run typecheck`, `mise run test`, `mise run lint`, and `mise run build`.
- [ ] Start the VS Code Extension Development Host using the existing `Run Pi x IDE VS Code Extension` launch configuration.
- [ ] Open a TypeScript file with a known error or warning in the Extension Development Host.
- [ ] Place the cursor inside the diagnostic range and open Quick Fix.
- [ ] Select `Fix with Pi suggest`.
- [ ] In a connected Pi TUI session, verify a new user message appears with `<!-- Diagnostic Context -->`, the diagnostic message, the file/range context, and the instruction `Analyze the errors and warnings that appear in the above locations and provide recommendations for resolution.`
- [ ] While Pi is already streaming, trigger `Fix with Pi suggest` again and verify the request is queued as a follow-up instead of throwing.
- [ ] Disconnect Pi, trigger `Fix with Pi suggest`, and verify VS Code shows `Pi x IDE: no Pi clients connected for Fix with Pi suggest.` without crashing.

**Validation:**

- Run: `mise run typecheck`
- Expected: Root and VS Code TypeScript compilation succeed.
- Run: `mise run test`
- Expected: All `node --test dist/test/*.test.js` tests pass.
- Run: `mise run lint`
- Expected: ESLint exits successfully.
- Run: `mise run build`
- Expected: Root TypeScript, VS Code extension bundle, and Neovim sidecar package build successfully.

## Final Validation

- Run: `mise run typecheck`
- Expected: TypeScript accepts root code and VS Code extension code.
- Run: `mise run test`
- Expected: Config schema check, compile, and all unit tests pass.
- Run: `mise run lint`
- Expected: No lint errors are reported.
- Run: `mise run build`
- Expected: `dist/`, `vscode/out/`, and Neovim sidecar artifacts are built successfully.
- Manual: Launch the VS Code Extension Development Host, trigger `Fix with Pi suggest` on an error/warning diagnostic, and confirm Pi receives and starts a diagnostic-analysis turn with the fixed template.

## Rollout Notes

- Ship the VS Code extension and Pi package together. The VS Code side can broadcast `diagnostic_fix_requested` to older Pi clients, but older clients will ignore the unknown notification and no diagnostic-analysis turn will start.
- No new `~/.pi/config.json` option or environment variable is planned for this iteration, so `src/shared/config-options.ts` and `schemas/config.json` do not need changes.
- Cursor and Windsurf should receive the feature through the existing VS Code-family extension package because the implementation uses standard VS Code `CodeActionProvider` APIs.
- User-customizable prompt input should be planned separately after this version lands, because it changes both VS Code UX and Pi prompt-building behavior.

## Risks and Mitigations

- VS Code diagnostic codes can contain URI objects that are not JSON-safe — Normalize codes into strings, numbers, or `{ value, target: string }` before placing them in the protocol payload.
- Diagnostic ranges can cover large generated or minified code — Limit selected text to `MAX_SELECTED_TEXT_CHARS` and context to two lines before/after each diagnostic.
- Generated diagnostic prompts could receive duplicate automatic selection context — Add the `pi-x-ide/diagnostic-context` marker and update `src/pi/context.ts` to skip selection-context merging for marker-bearing messages.
- Pi may be busy when a Quick Fix is invoked — Use `pi.sendUserMessage(prompt, { deliverAs: "followUp" })` and notify the user that the diagnostic fix request was queued.
- VS Code may offer Code Actions for stale diagnostics after edits — Include `documentVersion` in the payload so Pi can see which document version produced the diagnostic context, and rely on bounded source snippets to keep the request understandable.
