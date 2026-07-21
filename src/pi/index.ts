// ABOUTME: Registers the pi-x-ide extension lifecycle, commands, and IDE connection callbacks.
// ABOUTME: Coordinates session-scoped runtime state with editor WebSocket and polling integrations.
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent" with {
  "resolution-mode": "import",
};
import { logExtensionError } from "../shared/errors.js";
import { formatRangeMention } from "../shared/format.js";
import { hasDirectWorkspaceMatch } from "../shared/paths.js";
import type { AtMentionedParams, LockFileCandidate } from "../shared/protocol.js";
import { discoverIdeCandidates } from "./discovery.js";
import { IdeConnection, IdeConnectionTimeoutError, type IdeConnectionCallbacks } from "./connection.js";
import {
  discoverInstallCandidates,
  installIdeExtension,
  isAutoInstallEnabled,
  selectAutoInstallCandidate,
  type IdeInstallCandidate,
} from "./install.js";
import { registerIdeCommand } from "./commands.js";
import { clearLatestSelection, registerContextHandlers, setLatestSelection } from "./context.js";
import { handleDiagnosticFixRequested } from "./diagnostics.js";
import { registerDiagnosticRenderer } from "./diagnostic-renderer.js";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import {
  formatReconnectLimitMessage,
  RECONNECT_DELAY_MS,
  recordReconnectAttempt,
  resetReconnectState,
} from "./reconnect.js";
import { containPiError, runPiBoundary, runPiBoundaryAsync } from "./safety.js";
import { createRuntime, type PiIdeRuntime } from "./state.js";
import { clearIdeUi, updateIdeUi } from "./ui.js";
import { startZedPolling, stopZedPolling } from "./zed.js";

const INSTALL_RECONNECT_RETRY_MS = 1_500;
const INSTALL_RECONNECT_TIMEOUT_MS = 15_000;

let activePi: ExtensionAPI | undefined;

interface ConnectOptions {
  resetReconnectState?: boolean;
}

function formatConnectTimeoutMessage(error: IdeConnectionTimeoutError): string {
  return `${error.message}.`;
}

export default function (pi: ExtensionAPI): void {
  activePi = pi;
  const runtime = createRuntime();

  registerContextHandlers(pi, runtime);
  registerDiagnosticRenderer(pi);
  registerIdeCommand(pi, runtime, {
    refreshCandidates: (ctx) => refreshCandidates(runtime, ctx),
    connectAuto: (ctx) => connectAutoWithZedFallback(runtime, ctx),
    connectCandidate: (candidate, ctx) => connectCandidate(runtime, candidate, ctx),
    disconnect: (ctx, disabled) => disconnect(runtime, ctx, disabled),
    installExtension: (ctx) => installExtension(runtime, ctx),
  });

  pi.on("session_start", (_event, ctx) =>
    runPiBoundaryAsync(
      "Pi session start",
      runtime,
      async () => {
        runtime.sessionGeneration += 1;
        const generation = runtime.sessionGeneration;
        runtime.ctx = ctx;
        runtime.cwd = ctx.cwd;
        stopZedPolling(runtime);
        stopReconnectScheduling(runtime);
        if (!runtime.enabled) {
          runtime.connectionStatus = "disabled";
          updateIdeUi(runtime, ctx);
          return;
        }
        void maybeAutoInstallAndReconnect(runtime, ctx, generation);
        await connectAutoWithZedFallback(runtime, ctx, generation);
      },
      ctx,
    ),
  );

  pi.on("session_shutdown", (_event, ctx) =>
    runPiBoundary(
      "Pi session shutdown",
      runtime,
      () => {
        runtime.sessionGeneration += 1;
        runtime.ctx = ctx;
        stopZedPolling(runtime);
        stopReconnectScheduling(runtime);
        const connection = runtime.connection;
        runtime.connection = undefined;
        connection?.disconnect();
        clearIdeUi(runtime, ctx);
        runtime.ctx = undefined;
      },
      ctx,
    ),
  );
}

async function maybeAutoInstallAndReconnect(
  runtime: PiIdeRuntime,
  ctx: ExtensionContext,
  generation: number,
): Promise<void> {
  try {
    if (!isAutoInstallEnabled() || !isInstallSessionActive(runtime, generation)) return;

    const candidates = await discoverInstallCandidates();
    const candidate = selectAutoInstallCandidate(candidates);
    if (!candidate) return;
    if (!isInstallSessionActive(runtime, generation)) return;
    if (!candidate.needsInstall) return;

    notifyInstall(ctx, `Installing Pi x IDE extension for ${candidate.label}...`, "info");
    const result = await installIdeExtension(candidate, runtime);
    if (!isInstallSessionActive(runtime, generation)) return;

    if (!result.success) {
      notifyInstall(
        ctx,
        `Failed to install Pi x IDE extension for ${candidate.label}: ${describeInstallError(result.error, result.stderr)}`,
        "warning",
      );
      return;
    }

    notifyInstall(ctx, `Pi x IDE extension installed for ${candidate.label}. Trying to connect...`, "info");
    const connected = await retryConnectAfterInstall(runtime, ctx, generation);
    if (!isInstallSessionActive(runtime, generation)) return;

    if (connected && runtime.connectionStatus === "connected") {
      notifyInstall(ctx, `Pi x IDE extension installed for ${candidate.label}. Connected!`, "info");
    } else if (!connected) {
      notifyInstall(
        ctx,
        `Pi x IDE extension installed for ${candidate.label}. If Pi does not connect automatically, reload the IDE window and run /ide.`,
        "warning",
      );
    } else {
      notifyInstall(
        ctx,
        `Pi x IDE extension installed for ${candidate.label}. Connection attempt completed. Run /ide to retry if needed.`,
        "warning",
      );
    }
  } catch (error) {
    if (isInstallSessionActive(runtime, generation)) {
      notifyInstall(ctx, `Failed to auto-install Pi x IDE extension: ${errorMessage(error)}`, "warning");
    }
  }
}

async function installExtension(runtime: PiIdeRuntime, ctx: ExtensionCommandContext): Promise<void> {
  runtime.ctx = ctx;
  runtime.cwd = ctx.cwd;

  const candidates = await discoverInstallCandidates({ includeLowConfidence: true });
  if (candidates.length === 0) {
    ctx.ui.notify(
      "No supported VS Code-family IDE CLI found. Install VS Code, Cursor, or Windsurf CLI first.",
      "warning",
    );
    return;
  }

  const candidate = await selectManualInstallCandidate(candidates, ctx);
  if (!candidate) return;

  runtime.enabled = true;
  if (!candidate.needsInstall) {
    ctx.ui.notify(
      `${candidate.label} already has Pi x IDE ${candidate.installedVersion ?? candidate.targetVersion}.`,
      "info",
    );
    await connectAuto(runtime, ctx);
    return;
  }

  ctx.ui.notify(`${installActionLabel(candidate)} Pi x IDE extension for ${candidate.label}...`, "info");
  const result = await installIdeExtension(candidate, runtime);
  if (!result.success) {
    ctx.ui.notify(
      `Failed to install Pi x IDE extension for ${candidate.label}: ${describeInstallError(result.error, result.stderr)}`,
      "warning",
    );
    return;
  }

  ctx.ui.notify(`Pi x IDE extension installed for ${candidate.label}. Trying to connect...`, "info");
  const connected = await retryConnectAfterInstall(runtime, ctx, runtime.sessionGeneration);
  if (!connected && runtime.enabled) {
    ctx.ui.notify(
      `Pi x IDE extension installed for ${candidate.label}. If Pi does not connect automatically, reload the IDE window and run /ide auto.`,
      "warning",
    );
  }
}

async function selectManualInstallCandidate(
  candidates: IdeInstallCandidate[],
  ctx: ExtensionCommandContext,
): Promise<IdeInstallCandidate | undefined> {
  if (candidates.length === 1) return candidates[0];

  const labels = candidates.map((candidate, index) => `${index + 1}. ${formatInstallCandidate(candidate)}`);
  const choice = await ctx.ui.select("Select IDE to install Pi x IDE", labels);
  if (!choice) return undefined;
  return candidates[labels.indexOf(choice)];
}

async function retryConnectAfterInstall(
  runtime: PiIdeRuntime,
  ctx: ExtensionContext | ExtensionCommandContext,
  generation: number,
): Promise<boolean> {
  const deadline = Date.now() + INSTALL_RECONNECT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!isInstallSessionActive(runtime, generation)) return false;
    await sleep(INSTALL_RECONNECT_RETRY_MS);
    if (!isInstallSessionActive(runtime, generation)) return false;

    const candidates = await refreshCandidates(runtime, ctx);
    if (candidates.length === 0) continue;
    await connectAuto(runtime, ctx);
    return true;
  }
  return false;
}

function isInstallSessionActive(runtime: PiIdeRuntime, generation: number): boolean {
  return runtime.enabled && runtime.sessionGeneration === generation;
}

function formatInstallCandidate(candidate: IdeInstallCandidate): string {
  const version = candidate.installedVersion ? `installed ${candidate.installedVersion}` : "not installed";
  const status =
    candidate.reason === "current" ? "up to date" : `${installActionLabel(candidate).toLowerCase()} required`;
  return `${candidate.label} — ${version}, target ${candidate.targetVersion}, ${status} (${candidate.cliPath})`;
}

function installActionLabel(candidate: IdeInstallCandidate): string {
  if (candidate.reason === "outdated") return "Updating";
  if (candidate.reason === "unknown") return "Installing or updating";
  return "Installing";
}

function notifyInstall(
  ctx: ExtensionContext | ExtensionCommandContext,
  message: string,
  level: "info" | "warning",
): void {
  try {
    if (!ctx.hasUI) return;
    ctx.ui.notify(message, level);
  } catch (error) {
    logExtensionError("IDE install notification", error);
  }
}

function describeInstallError(error: string | undefined, stderr: string): string {
  const message = error || stderr.trim();
  return message || "unknown error";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function refreshCandidates(
  runtime: PiIdeRuntime,
  ctx: ExtensionContext | ExtensionCommandContext,
): Promise<LockFileCandidate[]> {
  runtime.ctx = ctx;
  runtime.cwd = ctx.cwd;
  runtime.candidates = await discoverIdeCandidates({ cwd: ctx.cwd });
  return runtime.candidates;
}

async function connectAutoWithZedFallback(
  runtime: PiIdeRuntime,
  ctx: ExtensionContext | ExtensionCommandContext,
  generation = runtime.sessionGeneration,
  options: ConnectOptions = {},
): Promise<void> {
  await connectAuto(runtime, ctx, options);
  if (runtime.connectionStatus !== "connected") {
    startZedPolling(runtime, ctx, { generation });
  }
}

async function connectAuto(
  runtime: PiIdeRuntime,
  ctx: ExtensionContext | ExtensionCommandContext,
  options: ConnectOptions = {},
): Promise<void> {
  runtime.enabled = true;
  const candidates = await refreshCandidates(runtime, ctx);
  const candidate = candidates.find((candidate) => isAutoConnectCandidate(candidate, ctx.cwd));
  if (!candidate) {
    if (options.resetReconnectState !== false) resetReconnectState(runtime);
    runtime.connectionStatus = "disconnected";
    runtime.connectionMessage =
      candidates.length > 0
        ? "No IDE lock file matches the current workspace. Use /ide to connect manually."
        : "No matching IDE lock files found.";
    runtime.currentCandidate = undefined;
    runtime.connectedServer = undefined;
    updateIdeUi(runtime, ctx);
    return;
  }
  await connectCandidate(runtime, candidate, ctx, options);
}

function isAutoConnectCandidate(candidate: LockFileCandidate, cwd: string): boolean {
  return hasDirectWorkspaceMatch(candidate.lock.workspaceFolders, cwd);
}

async function connectCandidate(
  runtime: PiIdeRuntime,
  candidate: LockFileCandidate,
  ctx: ExtensionContext | ExtensionCommandContext,
  options: ConnectOptions = {},
): Promise<void> {
  if (options.resetReconnectState !== false) resetReconnectState(runtime);
  runtime.ctx = ctx;
  runtime.cwd = ctx.cwd;
  runtime.enabled = true;
  stopZedPolling(runtime);
  stopReconnectScheduling(runtime);

  const previous = runtime.connection;
  runtime.connection = undefined;
  previous?.disconnect();

  runtime.currentCandidate = candidate;
  runtime.connectedServer = undefined;
  runtime.connectionStatus = "connecting";
  runtime.connectionMessage = `Connecting to ${candidate.lock.name} at ${candidate.lock.host}:${candidate.lock.port}`;
  updateIdeUi(runtime, ctx);

  const generation = runtime.sessionGeneration;
  const connectionRef: { current?: IdeConnection } = {};
  const connection = new IdeConnection(
    candidate,
    ctx.cwd,
    createConnectionCallbacks(activePi, runtime, () => connectionRef.current, generation),
  );
  connectionRef.current = connection;

  runtime.connection = connection;
  try {
    await connection.connect();
    if (runtime.connection === connection && runtime.connectionStatus === "connecting") {
      runtime.connectionStatus = "connected";
      runtime.connectionMessage = undefined;
      resetReconnectState(runtime);
      updateIdeUi(runtime, ctx);
    }
  } catch (error) {
    if (runtime.connection === connection) {
      runtime.connection = undefined;
      runtime.connectionStatus = "error";
      runtime.connectionMessage =
        error instanceof IdeConnectionTimeoutError ? formatConnectTimeoutMessage(error) : errorMessage(error);
      updateIdeUi(runtime, ctx);
      if (!(error instanceof IdeConnectionTimeoutError)) scheduleReconnect(runtime);
    }
  }
}

function createConnectionCallbacks(
  pi: ExtensionAPI | undefined,
  runtime: PiIdeRuntime,
  getConnection: () => IdeConnection | undefined,
  generation: number,
): IdeConnectionCallbacks {
  return {
    onConnected: (server) => {
      if (!isCurrentConnection(runtime, getConnection(), generation)) return;
      runtime.connectedServer = server;
      runtime.connectionStatus = "connected";
      runtime.connectionMessage = undefined;
      resetReconnectState(runtime);
      updateIdeUi(runtime);
    },
    onDisconnected: (reason) => {
      if (!isCurrentConnection(runtime, getConnection(), generation)) return;
      runtime.connection = undefined;
      runtime.connectedServer = undefined;
      runtime.connectionStatus = runtime.enabled ? "disconnected" : "disabled";
      runtime.connectionMessage = reason;
      updateIdeUi(runtime);
      if (runtime.enabled) scheduleReconnect(runtime);
    },
    onSelectionChanged: (snapshot) => {
      if (!isCurrentConnection(runtime, getConnection(), generation)) return;
      setLatestSelection(runtime, snapshot);
    },
    onSelectionCleared: () => {
      if (!isCurrentConnection(runtime, getConnection(), generation)) return;
      clearLatestSelection(runtime);
    },
    onAtMentioned: (params) => {
      if (!isCurrentConnection(runtime, getConnection(), generation)) return;
      handleAtMentioned(runtime, params);
    },
    onDiagnosticFixRequested: (params) => {
      if (!pi || !isCurrentConnection(runtime, getConnection(), generation)) return;
      handleDiagnosticFixRequested(pi, runtime, params);
    },
    onError: (error) => {
      if (!isCurrentConnection(runtime, getConnection(), generation)) return;
      containPiError(runtime, "IDE connection error", error);
    },
  };
}

function isCurrentConnection(
  runtime: PiIdeRuntime,
  connection: IdeConnection | undefined,
  generation = runtime.sessionGeneration,
): boolean {
  return runtime.sessionGeneration === generation && !!connection && runtime.connection === connection;
}

function stopReconnectScheduling(runtime: PiIdeRuntime): void {
  const fiber = runtime.reconnectFiber;
  runtime.reconnectFiber = undefined;
  if (fiber) Effect.runFork(Fiber.interrupt(fiber));
}

function disconnect(runtime: PiIdeRuntime, ctx: ExtensionContext | ExtensionCommandContext, disabled = false): void {
  runtime.ctx = ctx;
  stopZedPolling(runtime);
  stopReconnectScheduling(runtime);
  const connection = runtime.connection;
  runtime.connection = undefined;
  connection?.disconnect();
  resetReconnectState(runtime);
  runtime.enabled = !disabled;
  runtime.connectedServer = undefined;
  runtime.connectionStatus = disabled ? "disabled" : "disconnected";
  runtime.connectionMessage = disabled ? "IDE integration disabled." : "Disconnected.";
  if (disabled) {
    runtime.latestSelection = undefined;
    runtime.latestSelectionKey = undefined;
    runtime.turnSelection = undefined;
    runtime.attachState = "idle";
  }
  updateIdeUi(runtime, ctx);
}

function scheduleReconnect(runtime: PiIdeRuntime): void {
  if (runtime.reconnectFiber || !runtime.enabled) return;
  const generation = runtime.sessionGeneration;
  const attempt = recordReconnectAttempt(runtime, runtime.currentCandidate);
  if (attempt === undefined) {
    runtime.connectionStatus = "error";
    runtime.connectionMessage = formatReconnectLimitMessage(runtime.currentCandidate);
    updateIdeUi(runtime);
    return;
  }

  const fiber = Effect.runFork(
    Effect.gen(function* () {
      yield* Effect.sleep(`${RECONNECT_DELAY_MS} millis`);
      const ctx = runtime.ctx;
      if (!ctx || !runtime.enabled || runtime.sessionGeneration !== generation) return;
      yield* Effect.promise(() =>
        connectAutoWithZedFallback(runtime, ctx, runtime.sessionGeneration, { resetReconnectState: false }).catch(
          (error: unknown) => {
            containPiError(runtime, "IDE reconnect", error);
          },
        ),
      );
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (runtime.reconnectFiber === fiber) runtime.reconnectFiber = undefined;
        }),
      ),
    ),
  );
  runtime.reconnectFiber = fiber;
}

function handleAtMentioned(runtime: PiIdeRuntime, params: AtMentionedParams): void {
  setLatestSelection(runtime, params);
  const ctx = runtime.ctx;
  if (!ctx?.hasUI) return;
  const text = params.rangeText || formatRangeMention(params, { cwd: ctx.cwd });
  ctx.ui.pasteToEditor(text);
  ctx.ui.notify(`Attached ${text}`, "info");
}
