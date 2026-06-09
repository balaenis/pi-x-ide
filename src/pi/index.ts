import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent" with {
  "resolution-mode": "import",
};
import { formatRangeMention } from "../shared/format";
import type { AtMentionedParams, LockFileCandidate } from "../shared/protocol";
import { discoverIdeCandidates } from "./discovery";
import { IdeConnection } from "./connection";
import { registerIdeCommand } from "./commands";
import { registerContextHandlers, setLatestSelection } from "./context";
import { createRuntime, type PiIdeRuntime } from "./state";
import { clearIdeUi, updateIdeUi } from "./ui";

const RECONNECT_DELAY_MS = 2_000;

export default function (pi: ExtensionAPI): void {
  const runtime = createRuntime();

  registerContextHandlers(pi, runtime);
  registerIdeCommand(pi, runtime, {
    refreshCandidates: (ctx) => refreshCandidates(runtime, ctx),
    connectAuto: (ctx) => connectAuto(runtime, ctx),
    connectCandidate: (candidate, ctx) => connectCandidate(runtime, candidate, ctx),
    disconnect: (ctx, disabled) => disconnect(runtime, ctx, disabled),
  });

  pi.on("session_start", async (_event, ctx) => {
    runtime.ctx = ctx;
    runtime.cwd = ctx.cwd;
    if (!runtime.enabled) {
      runtime.connectionStatus = "disabled";
      updateIdeUi(runtime, ctx);
      return;
    }
    await connectAuto(runtime, ctx);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    runtime.ctx = ctx;
    if (runtime.reconnectTimer) clearTimeout(runtime.reconnectTimer);
    runtime.reconnectTimer = undefined;
    runtime.connection?.disconnect();
    runtime.connection = undefined;
    clearIdeUi(runtime, ctx);
  });
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

  const connection = new IdeConnection(candidate, ctx.cwd, {
    onConnected: (server) => {
      if (runtime.connection !== connection) return;
      runtime.connectedServer = server;
      runtime.connectionStatus = "connected";
      runtime.connectionMessage = undefined;
      updateIdeUi(runtime);
    },
    onDisconnected: (reason) => {
      if (runtime.connection !== connection) return;
      runtime.connection = undefined;
      runtime.connectedServer = undefined;
      runtime.connectionStatus = runtime.enabled ? "disconnected" : "disabled";
      runtime.connectionMessage = reason;
      updateIdeUi(runtime);
      if (runtime.enabled) scheduleReconnect(runtime);
    },
    onSelectionChanged: (snapshot) => {
      if (runtime.connection !== connection) return;
      setLatestSelection(runtime, snapshot);
    },
    onAtMentioned: (params) => {
      if (runtime.connection !== connection) return;
      handleAtMentioned(runtime, params);
    },
    onError: (error) => {
      if (runtime.connection !== connection) return;
      runtime.connectionStatus = "error";
      runtime.connectionMessage = error.message;
      updateIdeUi(runtime);
    },
  });

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
