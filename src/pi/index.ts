import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent" with {
  "resolution-mode": "import",
};
import { formatRangeMention } from "../shared/format";
import type { AtMentionedParams, LockFileCandidate } from "../shared/protocol";
import { discoverIdeCandidates } from "./discovery";
import { IdeConnection, type IdeConnectionCallbacks } from "./connection";
import {
  discoverInstallCandidates,
  installIdeExtension,
  isAutoInstallEnabled,
  selectAutoInstallCandidate,
  type IdeInstallCandidate,
} from "./install";
import { registerIdeCommand } from "./commands";
import { clearLatestSelection, registerContextHandlers, setLatestSelection } from "./context";
import { createRuntime, type PiIdeRuntime } from "./state";
import { clearIdeUi, updateIdeUi } from "./ui";

const RECONNECT_DELAY_MS = 2_000;
const INSTALL_RECONNECT_RETRY_MS = 1_500;
const INSTALL_RECONNECT_TIMEOUT_MS = 15_000;

export default function (pi: ExtensionAPI): void {
  const runtime = createRuntime();

  registerContextHandlers(pi, runtime);
  registerIdeCommand(pi, runtime, {
    refreshCandidates: (ctx) => refreshCandidates(runtime, ctx),
    connectAuto: (ctx) => connectAuto(runtime, ctx),
    connectCandidate: (candidate, ctx) => connectCandidate(runtime, candidate, ctx),
    disconnect: (ctx, disabled) => disconnect(runtime, ctx, disabled),
    installExtension: (ctx) => installExtension(runtime, ctx),
  });

  pi.on("session_start", async (_event, ctx) => {
    runtime.sessionGeneration += 1;
    const generation = runtime.sessionGeneration;
    runtime.ctx = ctx;
    runtime.cwd = ctx.cwd;
    if (!runtime.enabled) {
      runtime.connectionStatus = "disabled";
      updateIdeUi(runtime, ctx);
      return;
    }
    void maybeAutoInstallAndReconnect(runtime, ctx, generation);
    await connectAuto(runtime, ctx);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    runtime.sessionGeneration += 1;
    runtime.ctx = ctx;
    if (runtime.reconnectTimer) clearTimeout(runtime.reconnectTimer);
    runtime.reconnectTimer = undefined;
    runtime.connection?.disconnect();
    runtime.connection = undefined;
    clearIdeUi(runtime, ctx);
  });
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
    if (!connected && isInstallSessionActive(runtime, generation)) {
      notifyInstall(
        ctx,
        `Pi x IDE extension installed for ${candidate.label}. If Pi does not connect automatically, reload the IDE window and run /ide auto.`,
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
  if (!ctx.hasUI) return;
  ctx.ui.notify(message, level);
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

async function connectAuto(runtime: PiIdeRuntime, ctx: ExtensionContext | ExtensionCommandContext): Promise<void> {
  runtime.enabled = true;
  const candidates = await refreshCandidates(runtime, ctx);
  const candidate = candidates[0];
  if (!candidate) {
    runtime.connectionStatus = "disconnected";
    runtime.connectionMessage = "No matching IDE lock files found.";
    runtime.currentCandidate = undefined;
    runtime.connectedServer = undefined;
    updateIdeUi(runtime, ctx);
    return;
  }
  await connectCandidate(runtime, candidate, ctx);
}

async function connectCandidate(
  runtime: PiIdeRuntime,
  candidate: LockFileCandidate,
  ctx: ExtensionContext | ExtensionCommandContext,
): Promise<void> {
  runtime.ctx = ctx;
  runtime.cwd = ctx.cwd;
  runtime.enabled = true;
  if (runtime.reconnectTimer) clearTimeout(runtime.reconnectTimer);
  runtime.reconnectTimer = undefined;

  const previous = runtime.connection;
  runtime.connection = undefined;
  previous?.disconnect();

  runtime.currentCandidate = candidate;
  runtime.connectedServer = undefined;
  runtime.connectionStatus = "connecting";
  runtime.connectionMessage = `Connecting to ${candidate.lock.name} at ${candidate.lock.host}:${candidate.lock.port}`;
  updateIdeUi(runtime, ctx);

  const connectionRef: { current?: IdeConnection } = {};
  const connection = new IdeConnection(
    candidate,
    ctx.cwd,
    createConnectionCallbacks(runtime, () => connectionRef.current),
  );
  connectionRef.current = connection;

  runtime.connection = connection;
  try {
    await connection.connect();
    if (runtime.connection === connection && runtime.connectionStatus === "connecting") {
      runtime.connectionStatus = "connected";
      runtime.connectionMessage = undefined;
      updateIdeUi(runtime, ctx);
    }
  } catch (error) {
    if (runtime.connection === connection) {
      runtime.connection = undefined;
      runtime.connectionStatus = "error";
      runtime.connectionMessage = error instanceof Error ? error.message : String(error);
      updateIdeUi(runtime, ctx);
      scheduleReconnect(runtime);
    }
  }
}

function createConnectionCallbacks(
  runtime: PiIdeRuntime,
  getConnection: () => IdeConnection | undefined,
): IdeConnectionCallbacks {
  return {
    onConnected: (server) => {
      if (!isCurrentConnection(runtime, getConnection())) return;
      runtime.connectedServer = server;
      runtime.connectionStatus = "connected";
      runtime.connectionMessage = undefined;
      updateIdeUi(runtime);
    },
    onDisconnected: (reason) => {
      if (!isCurrentConnection(runtime, getConnection())) return;
      runtime.connection = undefined;
      runtime.connectedServer = undefined;
      runtime.connectionStatus = runtime.enabled ? "disconnected" : "disabled";
      runtime.connectionMessage = reason;
      updateIdeUi(runtime);
      if (runtime.enabled) scheduleReconnect(runtime);
    },
    onSelectionChanged: (snapshot) => {
      if (!isCurrentConnection(runtime, getConnection())) return;
      setLatestSelection(runtime, snapshot);
    },
    onSelectionCleared: () => {
      if (!isCurrentConnection(runtime, getConnection())) return;
      clearLatestSelection(runtime);
    },
    onAtMentioned: (params) => {
      if (!isCurrentConnection(runtime, getConnection())) return;
      handleAtMentioned(runtime, params);
    },
    onError: (error) => {
      if (!isCurrentConnection(runtime, getConnection())) return;
      runtime.connectionStatus = "error";
      runtime.connectionMessage = error.message;
      updateIdeUi(runtime);
    },
  };
}

function isCurrentConnection(runtime: PiIdeRuntime, connection: IdeConnection | undefined): boolean {
  return !!connection && runtime.connection === connection;
}

function disconnect(runtime: PiIdeRuntime, ctx: ExtensionContext | ExtensionCommandContext, disabled = false): void {
  runtime.ctx = ctx;
  if (runtime.reconnectTimer) clearTimeout(runtime.reconnectTimer);
  runtime.reconnectTimer = undefined;
  const connection = runtime.connection;
  runtime.connection = undefined;
  connection?.disconnect();
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
  if (runtime.reconnectTimer || !runtime.enabled) return;
  runtime.reconnectTimer = setTimeout(() => {
    runtime.reconnectTimer = undefined;
    const ctx = runtime.ctx;
    if (!ctx || !runtime.enabled) return;
    connectAuto(runtime, ctx).catch((error: unknown) => {
      runtime.connectionStatus = "error";
      runtime.connectionMessage = error instanceof Error ? error.message : String(error);
      updateIdeUi(runtime);
    });
  }, RECONNECT_DELAY_MS);
}

function handleAtMentioned(runtime: PiIdeRuntime, params: AtMentionedParams): void {
  setLatestSelection(runtime, params);
  const ctx = runtime.ctx;
  if (!ctx?.hasUI) return;
  const text = params.rangeText || formatRangeMention(params, { cwd: ctx.cwd });
  ctx.ui.pasteToEditor(text);
  ctx.ui.notify(`Attached ${text}`, "info");
}
