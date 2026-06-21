# JetBrains IDE Integration Implementation Plan

**Goal:** Add JetBrains IDE family support to pi-x-ide for live active-file tracking, live selection tracking, manual attach, status display, and opening Pi from the IDE.

**Inputs:** User request to write an implementation plan for JetBrains IDE integration without Quick Fix or automatic extension installation; feasibility analysis in `docs/analysis/jetbrains-ide-feasibility.md`; repository evidence from `src/shared/protocol.ts`, `src/shared/schema.ts`, `src/shared/ide-server.ts`, `src/shared/lock-file.ts`, `src/pi/connection.ts`, `src/pi/context.ts`, `src/pi/discovery.ts`, `ide-plugins/vscode/src/extension.ts`, `ide-plugins/vscode/src/selection.ts`, `ide-plugins/vscode/src/server.ts`, `ide-plugins/nvim/lua/pi_x_ide/init.lua`, `src/nvim/sidecar.ts`, `docs/specs/ide-protocol.md`, `package.json`, and `mise.toml`.

**Assumptions:**

- The first JetBrains release is an MVP and explicitly excludes diagnostic Quick Fix / inspection actions and Pi-side automatic extension installation.
- The JetBrains plugin is developed under `ide-plugins/jetbrains` as a separate Gradle/Kotlin plugin project and is packaged for manual local installation or JetBrains Marketplace distribution.
- Development targets IntelliJ IDEA Community 2026.1.3 and IntelliJ Platform Gradle Plugin 2.16.0 first; broader JetBrains product/version compatibility can be verified after the MVP works.
- The plugin uses `source: "jetbrains"` and lock files named `jetbrains-<pid>-<port>.lock`, while keeping protocol version `1` because the message shapes stay compatible.

**Architecture:** Create a project-scoped JetBrains plugin that starts a local authenticated WebSocket server, writes the existing pi-x-ide lock-file format, watches the selected editor and non-empty selections, and broadcasts `selection_changed`, `selection_cleared`, and `at_mentioned` JSON-RPC notifications. Pi-side changes are limited to accepting `jetbrains` as an `IdeSource`; discovery, connection, attach-state handling, and prompt context injection continue using the current lock-file/WebSocket protocol. The JetBrains plugin owns IDE UI concerns: status bar widget, attach action/keybinding, and open-Pi terminal action.

**Tech Stack:** Kotlin/JVM, Gradle, IntelliJ Platform Gradle Plugin 2.16.0, IntelliJ IDEA Community 2026.1.3, Java-WebSocket 1.6.0, Gson 2.14.0, JetBrains Terminal plugin API, Kotlin test, existing Node.js 26/Bun/Mise validation commands.

---

## File Map

- Create: `ide-plugins/jetbrains/settings.gradle.kts` — Gradle project name and plugin-management repositories for the JetBrains plugin.
- Create: `ide-plugins/jetbrains/build.gradle.kts` — IntelliJ Platform plugin configuration, Kotlin/JVM settings, dependencies, test task, plugin verification, and buildPlugin packaging.
- Create: `ide-plugins/jetbrains/gradle.properties` — Plugin metadata shared by Gradle tasks, including plugin id, version, platform type, platform version, and Java/Kotlin settings.
- Create: `ide-plugins/jetbrains/.gitignore` — Ignore Gradle build output and IDE-local files for the JetBrains plugin project.
- Create: `ide-plugins/jetbrains/src/main/resources/META-INF/plugin.xml` — JetBrains plugin descriptor, project service, status bar widget factory, actions, default shortcuts, and terminal plugin dependency.
- Create: `ide-plugins/jetbrains/src/main/kotlin/com/balaenis/pixide/PiXIdeProjectService.kt` — Project-scoped orchestrator that owns server lifecycle, lock-file lifecycle, current selection state, client count, and UI refresh.
- Create: `ide-plugins/jetbrains/src/main/kotlin/com/balaenis/pixide/PiXIdeStartupActivity.kt` — Project startup hook that initializes `PiXIdeProjectService` once the project is open.
- Create: `ide-plugins/jetbrains/src/main/kotlin/com/balaenis/pixide/protocol/PiXIdeProtocol.kt` — Kotlin data classes and constants matching `src/shared/protocol.ts` for MVP messages.
- Create: `ide-plugins/jetbrains/src/main/kotlin/com/balaenis/pixide/protocol/PiXIdeJson.kt` — Gson helpers for JSON-RPC request parsing and notification/response serialization.
- Create: `ide-plugins/jetbrains/src/main/kotlin/com/balaenis/pixide/lock/PiXIdeLockFileManager.kt` — Auth-token generation, lock-file path creation, atomic JSON write, permission best-effort, workspace refresh, and cleanup.
- Create: `ide-plugins/jetbrains/src/main/kotlin/com/balaenis/pixide/server/PiXIdeWebSocketServer.kt` — Local authenticated WebSocket server that handles initialize and broadcasts IDE notifications.
- Create: `ide-plugins/jetbrains/src/main/kotlin/com/balaenis/pixide/editor/PiXIdeEditorTracker.kt` — Registers JetBrains editor/project listeners and debounces selection publishing.
- Create: `ide-plugins/jetbrains/src/main/kotlin/com/balaenis/pixide/editor/PiXIdeSnapshotBuilder.kt` — Converts the selected JetBrains editor, file, carets, and selections into `EditorSelectionSnapshot` payloads.
- Create: `ide-plugins/jetbrains/src/main/kotlin/com/balaenis/pixide/editor/PiXIdeWorkspace.kt` — Resolves content roots, project base path, best workspace folder, and relative display paths.
- Create: `ide-plugins/jetbrains/src/main/kotlin/com/balaenis/pixide/util/PiXIdeDebouncer.kt` — Disposable Swing-timer debouncer used by editor event listeners.
- Create: `ide-plugins/jetbrains/src/main/kotlin/com/balaenis/pixide/actions/PiXIdeAttachSelectionAction.kt` — IDE action and default shortcut that sends `at_mentioned` and shows a notification when no Pi client is connected.
- Create: `ide-plugins/jetbrains/src/main/kotlin/com/balaenis/pixide/actions/PiXIdeOpenTerminalAction.kt` — IDE action that opens the embedded terminal and executes `pi` in the project directory.
- Create: `ide-plugins/jetbrains/src/main/kotlin/com/balaenis/pixide/ui/PiXIdeStatusBarWidgetFactory.kt` — Registers a project status bar widget.
- Create: `ide-plugins/jetbrains/src/main/kotlin/com/balaenis/pixide/ui/PiXIdeStatusBarWidget.kt` — Displays server/client/selection state and invokes attach on click.
- Create: `ide-plugins/jetbrains/src/test/kotlin/com/balaenis/pixide/protocol/PiXIdeJsonTest.kt` — Unit coverage for initialize parsing and JSON-RPC serialization.
- Create: `ide-plugins/jetbrains/src/test/kotlin/com/balaenis/pixide/lock/PiXIdeLockFileManagerTest.kt` — Unit coverage for lock-file shape, path, atomic write, and cleanup.
- Create: `ide-plugins/jetbrains/src/test/kotlin/com/balaenis/pixide/server/PiXIdeWebSocketServerTest.kt` — Unit/integration coverage for authenticated initialize and unauthorized connection behavior.
- Create: `ide-plugins/jetbrains/src/test/kotlin/com/balaenis/pixide/editor/PiXIdeSnapshotBuilderTest.kt` — Unit coverage for offset-to-position conversion, empty selections, multiple selections, and range mention formatting.
- Create: `ide-plugins/jetbrains/README.md` — JetBrains plugin development, packaging, local install, and manual smoke-test instructions.
- Modify: `src/shared/protocol.ts` — Add `"jetbrains"` to `IdeSource`.
- Modify: `src/shared/schema.ts` — Accept `"jetbrains"` in runtime validation for lock files, snapshots, and cleared-selection params.
- Modify: `test/shared.test.ts` — Add root TypeScript coverage that `jetbrains` lock files and snapshots are accepted and unsupported sources remain rejected.
- Modify: `docs/specs/ide-protocol.md` — Document JetBrains lock-file naming, source value, and MVP notification support.
- Modify: `README.md` — Add JetBrains installation, usage, verification, and feature parity details without Quick Fix or auto-install claims.
- Modify: `README.zh-CN.md` — Mirror the JetBrains user-facing documentation in Chinese.
- Modify: `package.json` — Add `jetbrains`/`intellij`/`idea` keywords and scripts for JetBrains plugin build/package commands.
- Modify: `mise.toml` — Add `compile:jetbrains`, `package:jetbrains`, and `verify:jetbrains` tasks, and include JetBrains in the existing all-IDE validation path.

## Out of Scope

- Do not implement JetBrains diagnostic Quick Fix, inspection, or intention actions that send `diagnostic_fix_requested`.
- Do not modify `src/pi/install.ts` to discover, install, or update JetBrains plugins.
- Do not add JetBrains-specific top-level configuration options or regenerate `schemas/config.json` unless a later requirement introduces user-configurable settings.

## Tasks

### Task 1: Extend the Shared Protocol for JetBrains

**Outcome:** Pi can discover and connect to JetBrains lock files without changing the existing WebSocket connection, context injection, or UI runtime logic.

**Files:**

- Modify: `src/shared/protocol.ts`
- Modify: `src/shared/schema.ts`
- Modify: `docs/specs/ide-protocol.md`
- Test: `test/shared.test.ts`

**Steps:**

- [ ] Change `IdeSource` in `src/shared/protocol.ts` from `"vscode" | "zed" | "nvim" | "unknown"` to `"vscode" | "zed" | "nvim" | "jetbrains" | "unknown"`.
- [ ] Update `isIdeSource()` in `src/shared/schema.ts` so `"jetbrains"` is accepted for `IdeLockFile`, `EditorSelectionSnapshot`, and `SelectionClearedParams` validation.
- [ ] Add a `test/shared.test.ts` case asserting `parseLockFileContent()` accepts a protocol version `1` lock file with `ide: "jetbrains"`, `transport: "ws"`, `host: "127.0.0.1"`, a valid `port`, an auth token, and a workspace folder.
- [ ] Add a `test/shared.test.ts` case asserting `isEditorSelectionSnapshot()` accepts `source: "jetbrains"` with a local file path and both empty and non-empty `ranges` arrays.
- [ ] Add a `test/shared.test.ts` assertion that an unsupported source string, for example `"intellij"`, is still rejected.
- [ ] Update `docs/specs/ide-protocol.md` so lock file examples mention `jetbrains-<pid>-<port>.lock` and the `source` list includes `jetbrains`.

**Validation:**

- Run: `mise run typecheck`
- Expected: TypeScript compiles with the expanded `IdeSource` union.
- Run: `mise run test`
- Expected: Existing tests pass, the new `jetbrains` validation tests pass, and unsupported source validation still fails as expected.

### Task 2: Scaffold the JetBrains Plugin Project

**Outcome:** `ide-plugins/jetbrains` is a buildable IntelliJ Platform plugin module with actions and services declared but no runtime selection behavior yet.

**Files:**

- Create: `ide-plugins/jetbrains/settings.gradle.kts`
- Create: `ide-plugins/jetbrains/build.gradle.kts`
- Create: `ide-plugins/jetbrains/gradle.properties`
- Create: `ide-plugins/jetbrains/.gitignore`
- Create: `ide-plugins/jetbrains/src/main/resources/META-INF/plugin.xml`
- Create: `ide-plugins/jetbrains/src/main/kotlin/com/balaenis/pixide/PiXIdeProjectService.kt`
- Create: `ide-plugins/jetbrains/src/main/kotlin/com/balaenis/pixide/PiXIdeStartupActivity.kt`
- Modify: `package.json`
- Modify: `mise.toml`

**Steps:**

- [ ] Create `settings.gradle.kts` with plugin-management repositories for `gradlePluginPortal()`, `mavenCentral()`, and JetBrains repositories required by the IntelliJ Platform Gradle Plugin.
- [ ] Create `build.gradle.kts` using `id("org.jetbrains.intellij.platform") version "2.16.0"`, Kotlin/JVM, Java toolchain `21`, `mavenCentral()`, and IntelliJ Platform repositories.
- [ ] Configure dependencies in `build.gradle.kts`: `intellijIdeaCommunity("2026.1.3")`, `bundledPlugin("org.jetbrains.plugins.terminal")`, `implementation("org.java-websocket:Java-WebSocket:1.6.0")`, `implementation("com.google.code.gson:gson:2.14.0")`, and `testImplementation(kotlin("test"))`.
- [ ] Configure `patchPluginXml` with plugin id `balaenis.pi-x-ide`, display name `Pi x IDE`, `sinceBuild` matching IntelliJ Platform 2026.1, and no `untilBuild` pin unless Gradle verification requires one.
- [ ] Create `gradle.properties` containing `pluginGroup=com.balaenis.pixide`, `pluginName=Pi x IDE`, `pluginVersion=1.13.1`, `platformType=IC`, `platformVersion=2026.1.3`, `kotlin.code.style=official`, and JVM memory settings for Gradle.
- [ ] Create `.gitignore` ignoring `.gradle/`, `build/`, `out/`, `.idea/`, and generated plugin sandbox directories.
- [ ] Create `plugin.xml` with a `projectService` for `com.balaenis.pixide.PiXIdeProjectService`, a `postStartupActivity` for `PiXIdeStartupActivity`, a status bar widget extension, an attach action, an open-terminal action, and a default `ctrl alt K` shortcut for attach.
- [ ] Add `// ABOUTME:` header comments to every new Kotlin and Gradle Kotlin DSL file, matching the repository's code-file header convention.
- [ ] Implement `PiXIdeProjectService` as a minimal disposable project service with `start()` and `dispose()` methods that record `idle` status and do not start a server yet.
- [ ] Implement `PiXIdeStartupActivity` so it retrieves `project.service<PiXIdeProjectService>()` and calls `start()` once per project.
- [ ] Add `package.json` scripts: `compile:jetbrains` running `cd ide-plugins/jetbrains && ./gradlew test`, `package:jetbrains` running `cd ide-plugins/jetbrains && ./gradlew buildPlugin`, and `verify:jetbrains` running `cd ide-plugins/jetbrains && ./gradlew verifyPlugin`.
- [ ] Add `jetbrains`, `intellij`, and `idea` to `package.json` keywords.
- [ ] Add `mise.toml` tasks `compile:jetbrains`, `package:jetbrains`, and `verify:jetbrains` that delegate to the package scripts or run the same Gradle commands directly.

**Validation:**

- Run: `cd ide-plugins/jetbrains && ./gradlew test`
- Expected: Gradle resolves the IntelliJ Platform, compiles the empty plugin module, and runs with zero test failures.
- Run: `cd ide-plugins/jetbrains && ./gradlew buildPlugin`
- Expected: A plugin ZIP is produced under `ide-plugins/jetbrains/build/distributions/`.
- Run: `mise run compile:jetbrains`
- Expected: The new Mise task executes the JetBrains plugin test/build path successfully.

### Task 3: Implement JetBrains Protocol and Lock-File Utilities

**Outcome:** The JetBrains plugin can produce protocol-compatible JSON messages and write a valid pi-x-ide lock file that Pi can parse.

**Files:**

- Create: `ide-plugins/jetbrains/src/main/kotlin/com/balaenis/pixide/protocol/PiXIdeProtocol.kt`
- Create: `ide-plugins/jetbrains/src/main/kotlin/com/balaenis/pixide/protocol/PiXIdeJson.kt`
- Create: `ide-plugins/jetbrains/src/main/kotlin/com/balaenis/pixide/lock/PiXIdeLockFileManager.kt`
- Create: `ide-plugins/jetbrains/src/test/kotlin/com/balaenis/pixide/protocol/PiXIdeJsonTest.kt`
- Create: `ide-plugins/jetbrains/src/test/kotlin/com/balaenis/pixide/lock/PiXIdeLockFileManagerTest.kt`

**Steps:**

- [ ] Define constants in `PiXIdeProtocol.kt`: `PROTOCOL_VERSION = 1`, `AUTH_HEADER = "x-pi-x-ide-authorization"`, `IDE_SOURCE = "jetbrains"`, `TRANSPORT = "ws"`, and `LOCK_FILE_EXTENSION = ".lock"`.
- [ ] Define Kotlin data classes matching the MVP protocol: `Position`, `ProtocolRange`, `SelectionRange`, `EditorSelectionSnapshot`, `SelectionClearedParams`, `AtMentionedParams`, `JsonRpcRequest`, `JsonRpcResponse`, `JsonRpcNotification`, `InitializeResult`, and `IdeLockFile`.
- [ ] Ensure data-class JSON field names match the TypeScript protocol exactly: `filePath`, `workspaceFolder`, `receivedAt`, `authToken`, `workspaceFolders`, `createdAt`, and `updatedAt`.
- [ ] Implement `PiXIdeJson.kt` using Gson 2.14.0 to parse incoming JSON objects, detect `jsonrpc: "2.0"`, read `id`, read `method`, and serialize responses/notifications.
- [ ] Implement `PiXIdeLockFileManager` to generate a 32-byte random auth token encoded as 64 lowercase hex characters via `SecureRandom`.
- [ ] Implement lock directory resolution as `${user.home}/.pi/pi-x-ide/lock` and lock-file path `jetbrains-${ProcessHandle.current().pid()}-${port}.lock`.
- [ ] Implement atomic lock write by creating the lock directory, writing JSON to a temp file in the same directory, then moving it with `StandardCopyOption.ATOMIC_MOVE` and falling back to `REPLACE_EXISTING` if the filesystem does not support atomic moves.
- [ ] Apply best-effort POSIX permissions: directory `0700` and file `0600`; ignore `UnsupportedOperationException` on non-POSIX filesystems.
- [ ] Implement `refresh(workspaceFolders)` to update `workspaceFolders` and `updatedAt` while preserving `createdAt`, `authToken`, `host`, and `port`.
- [ ] Implement `cleanup()` to delete the current lock file and leave unrelated lock files untouched.
- [ ] Test that `PiXIdeJson` serializes an initialize response with `protocolVersion: 1`, server name `Pi x IDE JetBrains`, and `ide: "jetbrains"`.
- [ ] Test that `PiXIdeLockFileManager` writes valid JSON containing `version: 1`, `ide: "jetbrains"`, `transport: "ws"`, `host: "127.0.0.1"`, the requested port, a 64-character auth token, and the provided workspace folders.
- [ ] Test that `cleanup()` deletes the written lock file and does not throw when called twice.

**Validation:**

- Run: `cd ide-plugins/jetbrains && ./gradlew test --tests '*PiXIdeJsonTest' --tests '*PiXIdeLockFileManagerTest'`
- Expected: JSON and lock-file tests pass, including auth-token length and lock cleanup assertions.
- Run: `mise run test`
- Expected: Root TypeScript tests still parse the JetBrains lock-file shape accepted by the Kotlin utility.

### Task 4: Implement the Local WebSocket Server

**Outcome:** The JetBrains plugin starts an authenticated local WebSocket server, responds to Pi's `initialize` request, sends the initial selection state, and broadcasts selection notifications to connected clients.

**Files:**

- Create: `ide-plugins/jetbrains/src/main/kotlin/com/balaenis/pixide/server/PiXIdeWebSocketServer.kt`
- Modify: `ide-plugins/jetbrains/src/main/kotlin/com/balaenis/pixide/PiXIdeProjectService.kt`
- Create: `ide-plugins/jetbrains/src/test/kotlin/com/balaenis/pixide/server/PiXIdeWebSocketServerTest.kt`

**Steps:**

- [ ] Implement `PiXIdeWebSocketServer` using `org.java_websocket.server.WebSocketServer` bound to `InetSocketAddress("127.0.0.1", 0)` so the OS selects a free local port.
- [ ] Expose read-only `port`, `clientCount`, and `isRunning` properties.
- [ ] Validate the incoming `x-pi-x-ide-authorization` header before processing messages; if Java-WebSocket cannot return HTTP 401 during handshake on the chosen API path, close the connection with policy-violation close code `1008` before sending any response.
- [ ] Maintain a thread-safe set of open, authorized sockets and remove sockets on close/error.
- [ ] On an incoming `initialize` JSON-RPC request, respond with `InitializeResult(protocolVersion = 1, server = { name = "Pi x IDE JetBrains", version = pluginVersion, ide = "jetbrains" })`.
- [ ] Immediately after a successful initialize response, send either `selection_changed` with `getInitialSelection()` or `selection_cleared` with `source: "jetbrains"`, `reason: "no-active-editor"`, and `receivedAt` set to the current epoch milliseconds.
- [ ] Add `broadcastNotification(method, params)` that serializes JSON-RPC notifications and sends them to authorized open sockets only.
- [ ] Add `sendAtMentioned(snapshot, rangeText)` that broadcasts `method: "at_mentioned"` with `rangeText` and returns whether at least one client was sent the message.
- [ ] Implement `stop()` to close sockets, stop the server, clear socket state, and tolerate repeated calls.
- [ ] Update `PiXIdeProjectService.start()` to create auth token and workspace folders, start `PiXIdeWebSocketServer`, write the lock file through `PiXIdeLockFileManager`, and expose status `connected` when the server is listening.
- [ ] Update `PiXIdeProjectService.dispose()` to stop editor tracking if registered, delete the lock file, and stop the WebSocket server.
- [ ] Test a valid client using JDK `HttpClient.newWebSocketBuilder().header(AUTH_HEADER, token)` and assert it receives initialize response plus initial `selection_cleared` when no selection exists.
- [ ] Test an invalid token and assert no initialize response is delivered.
- [ ] Test `clientCount` transitions from `0` to `1` after an authorized client connects and back to `0` after close.

**Validation:**

- Run: `cd ide-plugins/jetbrains && ./gradlew test --tests '*PiXIdeWebSocketServerTest'`
- Expected: Authorized initialize, unauthorized rejection, broadcast, and cleanup tests pass.
- Run: `cd ide-plugins/jetbrains && ./gradlew test`
- Expected: All JetBrains plugin unit tests pass with no leaked server thread preventing Gradle exit.

### Task 5: Implement Editor Tracking and Snapshot Conversion

**Outcome:** The JetBrains plugin publishes active-file and non-empty selection changes in the same payload shape used by the existing VS Code and Neovim integrations.

**Files:**

- Create: `ide-plugins/jetbrains/src/main/kotlin/com/balaenis/pixide/editor/PiXIdeEditorTracker.kt`
- Create: `ide-plugins/jetbrains/src/main/kotlin/com/balaenis/pixide/editor/PiXIdeSnapshotBuilder.kt`
- Create: `ide-plugins/jetbrains/src/main/kotlin/com/balaenis/pixide/editor/PiXIdeWorkspace.kt`
- Create: `ide-plugins/jetbrains/src/main/kotlin/com/balaenis/pixide/util/PiXIdeDebouncer.kt`
- Modify: `ide-plugins/jetbrains/src/main/kotlin/com/balaenis/pixide/PiXIdeProjectService.kt`
- Create: `ide-plugins/jetbrains/src/test/kotlin/com/balaenis/pixide/editor/PiXIdeSnapshotBuilderTest.kt`

**Steps:**

- [ ] Implement `PiXIdeWorkspace.workspaceFolders(project)` to return unique local content-root paths from `ProjectRootManager.getInstance(project).contentRoots`, plus `project.basePath` when present.
- [ ] Implement `PiXIdeWorkspace.bestWorkspaceFolder(project, filePath)` to choose the longest workspace folder that contains the file path, falling back to the first workspace folder when no containment match exists.
- [ ] Implement `PiXIdeWorkspace.relativePath(filePath, workspaceFolder)` using `Path.relativize()` and forward slashes for range mentions.
- [ ] Implement `PiXIdeSnapshotBuilder.activeSnapshot(project)` that reads `FileEditorManager.getInstance(project).selectedTextEditor` and returns `null` when no text editor is selected.
- [ ] Ignore non-local files by returning `null` when `FileDocumentManager.getInstance().getFile(document)` is absent or the virtual file is not in the local filesystem.
- [ ] For the active editor, build `EditorSelectionSnapshot(source = "jetbrains", filePath = virtualFile.path, workspaceFolder = bestWorkspaceFolder, ranges = ...)`.
- [ ] Convert all non-empty carets from `editor.caretModel.allCarets` into `SelectionRange` entries sorted by start offset.
- [ ] For each range, use `document.getText(TextRange(startOffset, endOffset))` for `text`.
- [ ] Convert offsets to zero-based protocol positions with `document.getLineNumber(offset)` and `offset - document.getLineStartOffset(line)` so `character` is a Java/Kotlin UTF-16 code-unit offset matching the existing protocol.
- [ ] If the active file has no non-empty selections, publish the active file snapshot with `ranges: []`.
- [ ] Implement `PiXIdeDebouncer` with a Swing `Timer` delay of `150` ms, restarting the timer on repeated events and disposing the timer with the project service.
- [ ] Implement `PiXIdeEditorTracker` to subscribe to `FileEditorManagerListener.FILE_EDITOR_MANAGER`, `EditorFactory.getInstance().eventMulticaster.addSelectionListener(...)`, and caret movement events, then debounce calls to `PiXIdeProjectService.publishCurrentSelection()`.
- [ ] In `PiXIdeProjectService.publishCurrentSelection()`, broadcast `selection_changed` when `activeSnapshot()` returns a snapshot, otherwise broadcast `selection_cleared`.
- [ ] Refresh the lock file workspace folders when project roots change or when the tracker starts, using the lock manager's `refresh()` method.
- [ ] Test offset conversion for single-line ASCII selection, multi-line selection, and a line containing an astral emoji; expected `character` is based on UTF-16 code units.
- [ ] Test that an active local file with no selected text yields `ranges: []` rather than `selection_cleared`.
- [ ] Test that multiple non-empty carets produce multiple `ranges` sorted by start position.

**Validation:**

- Run: `cd ide-plugins/jetbrains && ./gradlew test --tests '*PiXIdeSnapshotBuilderTest'`
- Expected: Snapshot conversion tests pass for active-file, empty-selection, multi-selection, and UTF-16 character-offset scenarios.
- Run: `cd ide-plugins/jetbrains && ./gradlew test`
- Expected: All JetBrains plugin unit tests pass.
- Run: `cd ide-plugins/jetbrains && ./gradlew runIde`
- Expected: In the sandbox IDE, opening and selecting text in a local project does not throw plugin errors in the IDE log.

### Task 6: Implement Attach Action, Status Bar, and Open-Pi Terminal Action

**Outcome:** Users can see JetBrains connection state, attach the active file or selected range from the IDE, and open a Pi terminal from JetBrains.

**Files:**

- Create: `ide-plugins/jetbrains/src/main/kotlin/com/balaenis/pixide/actions/PiXIdeAttachSelectionAction.kt`
- Create: `ide-plugins/jetbrains/src/main/kotlin/com/balaenis/pixide/actions/PiXIdeOpenTerminalAction.kt`
- Create: `ide-plugins/jetbrains/src/main/kotlin/com/balaenis/pixide/ui/PiXIdeStatusBarWidgetFactory.kt`
- Create: `ide-plugins/jetbrains/src/main/kotlin/com/balaenis/pixide/ui/PiXIdeStatusBarWidget.kt`
- Modify: `ide-plugins/jetbrains/src/main/resources/META-INF/plugin.xml`
- Modify: `ide-plugins/jetbrains/src/main/kotlin/com/balaenis/pixide/PiXIdeProjectService.kt`

**Steps:**

- [ ] Implement `PiXIdeProjectService.formatRangeMention(snapshot)` matching `src/shared/format.ts`: `@relative/path` for empty `ranges`, or `@relative/path#L<start>` / `@relative/path#L<start>-L<end>` for the first range.
- [ ] Implement `PiXIdeAttachSelectionAction` so it obtains `PiXIdeProjectService`, builds the current snapshot with `PiXIdeSnapshotBuilder`, sends `at_mentioned`, and displays `Pi x IDE attached @path#Lx-Ly` on success.
- [ ] If no active local file is available, show a warning notification: `Pi x IDE: no active file to attach.`
- [ ] If the WebSocket server has zero connected Pi clients, still build the range mention and show a warning notification: `Pi x IDE: no Pi clients connected. Reference: @path#Lx-Ly`.
- [ ] Register `PiXIdeAttachSelectionAction` in `plugin.xml` with action id `PiXIde.AttachSelection`, text `Pi x IDE: Attach Selection`, and default shortcut `ctrl alt K`.
- [ ] Implement `PiXIdeStatusBarWidgetFactory` with widget id `pi-x-ide` and display name `Pi x IDE`.
- [ ] Implement `PiXIdeStatusBarWidget` as a text widget showing `⧉ Pi x IDE waiting` when no Pi client is connected, `⧉ Pi x IDE <n> Pi` when clients are connected, and `⧉ Pi x IDE @relative/path#Lx-Ly` when a latest snapshot exists.
- [ ] Make the status bar widget click action invoke `PiXIde.AttachSelection`.
- [ ] Trigger `StatusBar.updateWidget("pi-x-ide")` from `PiXIdeProjectService` after server start, client count changes, selection publication, and service disposal.
- [ ] Implement `PiXIdeOpenTerminalAction` using `TerminalToolWindowManager.getInstance(project)` and the stable `TerminalWidget` interface, create a terminal named `Pi`, set the working directory to `project.basePath` when present, execute `pi`, and show the terminal.
- [ ] Register `PiXIdeOpenTerminalAction` in `plugin.xml` with action id `PiXIde.OpenTerminal` and text `Pi x IDE: Open Pi Terminal`.

**Validation:**

- Run: `cd ide-plugins/jetbrains && ./gradlew buildPlugin`
- Expected: The plugin compiles and packages with the action and status bar declarations accepted by plugin XML validation.
- Run: `cd ide-plugins/jetbrains && ./gradlew runIde`
- Expected: The sandbox IDE shows the Pi x IDE status widget; `Ctrl+Alt+K` invokes attach; the open-terminal action creates a terminal and sends `pi`.

### Task 7: Document JetBrains MVP Usage and Packaging

**Outcome:** Users and maintainers can install, test, and package the JetBrains MVP without reading source code, and docs do not claim unsupported Quick Fix or auto-install behavior.

**Files:**

- Create: `ide-plugins/jetbrains/README.md`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `docs/specs/ide-protocol.md`
- Modify: `package.json`
- Modify: `mise.toml`

**Steps:**

- [ ] Add `ide-plugins/jetbrains/README.md` with prerequisites: JDK 21, Gradle wrapper, IntelliJ IDEA Community sandbox, and Pi installed on PATH.
- [ ] Document JetBrains local run command: `cd ide-plugins/jetbrains && ./gradlew runIde`.
- [ ] Document JetBrains package command: `cd ide-plugins/jetbrains && ./gradlew buildPlugin` and expected ZIP path `ide-plugins/jetbrains/build/distributions/`.
- [ ] Document manual verification: open a local project in sandbox IDE, run Pi in the same project directory, select text, expect Pi TUI widget to show a JetBrains source and pending/sent attach state.
- [ ] Update `README.md` installation section with JetBrains manual install/local sandbox instructions and state that Quick Fix and auto-install are not part of the JetBrains MVP.
- [ ] Update `README.md` feature parity table with a JetBrains column: live file tracking ✅, live selection tracking ✅, IDE context attach shortcut ✅, Pi TUI attach shortcut ✅, LLM context injection ✅, `/ide auto` ✅, diagnostic Quick Fix ❌, auto-install ❌.
- [ ] Mirror the same user-facing JetBrains documentation in `README.zh-CN.md`.
- [ ] Update `docs/specs/ide-protocol.md` to include `jetbrains` in the notification examples' source list and mention that JetBrains sends only selection and attach notifications in this MVP.
- [ ] Ensure `package.json` scripts and `mise.toml` tasks listed in Task 2 are documented in the Development section.

**Validation:**

- Run: `mise run format:check`
- Expected: Markdown, JSON, TypeScript, and config formatting checks pass.
- Run: `mise run lint`
- Expected: Existing repository lint passes after documentation and script updates.

### Task 8: Perform End-to-End Validation

**Outcome:** The MVP works from a JetBrains sandbox IDE to Pi without Quick Fix or auto-install code paths.

**Files:**

- Modify: `docs/plans/2026-06-21-jetbrains-ide-integration-plan.md` only if implementation findings require updating validation notes.

**Steps:**

- [ ] Run the root TypeScript validation to confirm `jetbrains` source support did not regress existing VS Code, Zed, or Neovim behavior.
- [ ] Run the JetBrains plugin unit tests and plugin packaging task.
- [ ] Start the JetBrains sandbox with `runIde`, open this repository as the project, and confirm a lock file named `jetbrains-<pid>-<port>.lock` appears under `~/.pi/pi-x-ide/lock/`.
- [ ] Read the lock file and confirm it contains `ide: "jetbrains"`, `transport: "ws"`, `host: "127.0.0.1"`, a valid port, a non-empty auth token, and a workspace folder matching the opened project.
- [ ] Start `pi` from the same repository directory and confirm Pi connects automatically through the existing `/ide auto` matching behavior.
- [ ] Open `src/shared/protocol.ts` in the sandbox IDE with no selection and confirm Pi shows the currently open file as JetBrains context.
- [ ] Select a non-empty range in the sandbox IDE and confirm Pi shows the file and line span with pending attach state.
- [ ] Press `Ctrl+Alt+K` in the sandbox IDE and confirm Pi input receives an `@relative/path#Lx-Ly` mention.
- [ ] Submit a prompt in Pi and confirm the selected text is injected into the prompt context and the Pi widget moves from pending to sent.
- [ ] Invoke `Pi x IDE: Open Pi Terminal` and confirm the embedded terminal starts in the project directory and executes `pi`.

**Validation:**

- Run: `mise run test`
- Expected: Root schema, discovery, connection, context, diagnostics, install, Zed, and Neovim tests pass.
- Run: `cd ide-plugins/jetbrains && ./gradlew test buildPlugin verifyPlugin`
- Expected: JetBrains plugin unit tests pass, plugin ZIP is produced, and IntelliJ plugin verification succeeds for the configured 2026.1.3 target.
- Run: `cd ide-plugins/jetbrains && ./gradlew runIde`
- Expected: Manual smoke checks confirm lock-file discovery, Pi connection, file tracking, selection tracking, attach shortcut, and terminal action.

## Final Validation

- Run: `mise run typecheck`
- Expected: Root TypeScript and VS Code extension type checks pass.
- Run: `mise run test`
- Expected: All root Node tests pass, including new `jetbrains` source validation.
- Run: `mise run lint`
- Expected: ESLint passes for existing TypeScript and JavaScript files.
- Run: `mise run format:check`
- Expected: Prettier accepts repository formatting.
- Run: `cd ide-plugins/jetbrains && ./gradlew test buildPlugin verifyPlugin`
- Expected: JetBrains unit tests pass, plugin ZIP is produced under `build/distributions/`, and plugin verification succeeds against IntelliJ IDEA Community 2026.1.3.
- Run: `cd ide-plugins/jetbrains && ./gradlew runIde`
- Expected: Manual sandbox smoke test proves Pi auto-connects through the lock file, receives active-file and selected-text updates, attaches `@relative/path#Lx-Ly`, and opens a Pi terminal.

## Rollout Notes

- JetBrains installation is manual for the MVP: users install a locally built ZIP or a Marketplace-published plugin when available; Pi will not auto-install or auto-update it.
- The lock-file protocol remains version `1`, so existing Pi releases that include `jetbrains` in `IdeSource` can connect without a protocol migration.
- A project with multiple JetBrains windows will create one lock file per open project because the service is project-scoped and each WebSocket server gets its own OS-selected port.
- The JetBrains plugin requires Pi to be available on `PATH` only for the open-terminal action; selection tracking and attach work without invoking `pi` from the IDE.
- Marketplace publishing, signing credentials, and CI publishing are separate release tasks after the MVP plugin ZIP is verified locally.

## Risks and Mitigations

- **Java-WebSocket cannot return the same HTTP 401 handshake response as the VS Code `ws` server** — Validate the auth token before processing any messages and close unauthorized clients with code `1008`; add tests proving unauthorized clients receive no initialize response or selection payload.
- **JetBrains editor columns differ from VS Code/LSP character offsets** — Compute `character` from document offsets and line-start offsets, which are Java UTF-16 code-unit counts, and cover emoji/astral-character cases in `PiXIdeSnapshotBuilderTest`.
- **Multiple open JetBrains projects can race on lock-file lifecycle** — Include PID and port in each lock-file name, scope services to projects, and delete only the lock file owned by the current service instance.
- **Gradle/IntelliJ dependency resolution can slow regular Node-focused development** — Keep JetBrains validation in explicit `compile:jetbrains`, `package:jetbrains`, and `verify:jetbrains` tasks; include it in `build:all` rather than the default quick Node test path.
- **Terminal API changes across JetBrains Platform versions** — Use the stable `TerminalWidget` interface and verify against IntelliJ IDEA Community 2026.1.3 during MVP validation.
- **Unsupported non-local or virtual files could produce unusable paths** — Return `selection_cleared` for non-local files and only send snapshots for local filesystem `VirtualFile` instances.
