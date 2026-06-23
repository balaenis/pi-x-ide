// ABOUTME: Implements the Pi-side WebSocket client that receives IDE selection notifications.
// ABOUTME: Contains callback dispatch boundaries so IDE messages cannot crash the Pi process.
import WebSocket from "ws";
import { EXT_CONFIG_NAME } from "../shared/config";
import {
  AUTH_HEADER,
  type DiagnosticFixRequestedParams,
  PROTOCOL_VERSION,
  type AtMentionedParams,
  type EditorSelectionSnapshot,
  type JsonRpcResponse,
  type LockFileCandidate,
  type SelectionChangedParams,
  type SelectionClearedParams,
} from "../shared/protocol";
import {
  isAtMentionedParams,
  isDiagnosticFixRequestedParams,
  isSelectionChangedParams,
  isSelectionClearedParams,
} from "../shared/schema";
import { toError, logExtensionError } from "../shared/errors";
import { formatRangeMention } from "../shared/format";
import { normalizeEditorSelectionSnapshotForHost } from "../shared/platform";
import { decodeRawData } from "../shared/ws";
import { resolveIdeHost } from "./ide-host";

export const IDE_CONNECT_TIMEOUT_MS = 5_000;

export class IdeConnectionTimeoutError extends Error {
  constructor(
    readonly candidate: LockFileCandidate,
    readonly host: string = candidate.lock.host,
  ) {
    super(`Timed out connecting to ${candidate.lock.name} at ${host}:${candidate.lock.port}`);
    this.name = "IdeConnectionTimeoutError";
  }
}

export interface IdeConnectionCallbacks {
  onConnected?: (server: { name: string; version?: string; ide?: string }) => void;
  onDisconnected?: (reason: string) => void;
  onSelectionChanged?: (snapshot: EditorSelectionSnapshot) => void;
  onSelectionCleared?: (params: SelectionClearedParams) => void;
  onAtMentioned?: (params: AtMentionedParams) => void;
  onDiagnosticFixRequested?: (params: DiagnosticFixRequestedParams) => void;
  onError?: (error: Error) => void;
}

export interface IdeConnectionOptions {
  resolveHost?: (lock: LockFileCandidate["lock"]) => Promise<string>;
  env?: NodeJS.ProcessEnv;
}

export class IdeConnection {
  private socket?: WebSocket;
  private nextId = 1;
  private closedByUser = false;

  constructor(
    readonly candidate: LockFileCandidate,
    private readonly cwd: string,
    private readonly callbacks: IdeConnectionCallbacks,
    private readonly options: IdeConnectionOptions = {},
  ) {}

  get isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  async connect(timeoutMs = IDE_CONNECT_TIMEOUT_MS): Promise<void> {
    this.closedByUser = false;
    const { lock } = this.candidate;
    const resolvedHost = await (this.options.resolveHost ?? resolveIdeHost)(lock);
    const socket = new WebSocket(`ws://${resolvedHost}:${lock.port}`, {
      handshakeTimeout: timeoutMs + 1_000,
      headers: {
        [AUTH_HEADER]: lock.authToken,
      },
    });
    this.socket = socket;

    socket.on("message", (raw) => this.runSocketHandler("message", () => this.handleMessage(decodeRawData(raw))));
    socket.on("close", (_code, reason) => {
      this.runSocketHandler("close", () => {
        if (this.socket !== socket) return;
        this.socket = undefined;
        this.emitCallback("disconnected callback", () =>
          this.callbacks.onDisconnected?.(reason.toString("utf8") || (this.closedByUser ? "closed" : "disconnected")),
        );
      });
    });
    socket.on("error", (error) => {
      if (this.socket === socket) this.reportError("websocket error", error);
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        if (this.socket === socket) this.socket = undefined;
        socket.terminate();
        reject(new IdeConnectionTimeoutError(this.candidate, resolvedHost));
      }, timeoutMs);
      const onOpen = () => {
        cleanup();
        this.sendInitialize();
        resolve();
      };
      const onError = (error: Error) => {
        cleanup();
        if (this.socket === socket) this.socket = undefined;
        reject(error);
      };
      const cleanup = () => {
        clearTimeout(timeout);
        socket.off("open", onOpen);
        socket.off("error", onError);
      };
      socket.once("open", onOpen);
      socket.once("error", onError);
    });
  }

  disconnect(): void {
    this.closedByUser = true;
    this.socket?.close();
    this.socket = undefined;
  }

  private sendInitialize(): void {
    this.socket?.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: this.nextId++,
        method: "initialize",
        params: {
          protocolVersion: PROTOCOL_VERSION,
          client: { name: EXT_CONFIG_NAME, version: "0.1.0" },
          cwd: this.cwd,
        },
      }),
    );
  }

  private handleMessage(text: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      return;
    }

    if (isRpcResponse(parsed)) {
      const server = getServerInfo(parsed);
      if (server) this.emitCallback("connected callback", () => this.callbacks.onConnected?.(server));
      return;
    }

    if (!isNotification(parsed)) return;
    if (parsed.method === "selection_changed" && isSelectionChangedParams(parsed.params)) {
      const params = normalizeEditorSelectionSnapshotForHost(withReceivedAt(parsed.params), this.options.env);
      this.emitCallback("selection changed callback", () => this.callbacks.onSelectionChanged?.(params));
    } else if (parsed.method === "selection_cleared" && isSelectionClearedParams(parsed.params)) {
      const params = withReceivedAt(parsed.params);
      this.emitCallback("selection cleared callback", () => this.callbacks.onSelectionCleared?.(params));
    } else if (parsed.method === "at_mentioned" && isAtMentionedParams(parsed.params)) {
      const snapshot = normalizeEditorSelectionSnapshotForHost(withReceivedAt(parsed.params), this.options.env);
      const params = { ...snapshot, rangeText: formatRangeMention(snapshot, { cwd: this.cwd, env: this.options.env }) };
      this.emitCallback("at mentioned callback", () => this.callbacks.onAtMentioned?.(params));
    } else if (parsed.method === "diagnostic_fix_requested" && isDiagnosticFixRequestedParams(parsed.params)) {
      const params = withReceivedAt(parsed.params);
      this.emitCallback("diagnostic fix requested callback", () => this.callbacks.onDiagnosticFixRequested?.(params));
    }
  }

  private runSocketHandler(label: string, action: () => void): void {
    try {
      action();
    } catch (error) {
      this.reportError(`websocket ${label}`, error);
    }
  }

  private emitCallback(label: string, action: () => void): void {
    try {
      action();
    } catch (error) {
      this.reportError(label, error);
    }
  }

  private reportError(label: string, error: unknown): void {
    const reported = toError(error, label);
    if (!this.callbacks.onError) {
      logExtensionError(label, reported);
      return;
    }
    try {
      this.callbacks.onError(reported);
    } catch (callbackError) {
      logExtensionError(`${label} onError callback`, callbackError);
    }
  }
}

function withReceivedAt<
  T extends SelectionChangedParams | SelectionClearedParams | AtMentionedParams | DiagnosticFixRequestedParams,
>(params: T): T {
  return { ...params, receivedAt: params.receivedAt ?? Date.now() };
}

function isNotification(value: unknown): value is { jsonrpc: "2.0"; method: string; params?: unknown } {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { jsonrpc?: unknown }).jsonrpc === "2.0" &&
    typeof (value as { method?: unknown }).method === "string"
  );
}

function isRpcResponse(value: unknown): value is JsonRpcResponse {
  return (
    typeof value === "object" && value !== null && (value as { jsonrpc?: unknown }).jsonrpc === "2.0" && "id" in value
  );
}

function getServerInfo(response: JsonRpcResponse): { name: string; version?: string; ide?: string } | undefined {
  const result = response.result;
  if (!result || typeof result !== "object") return undefined;
  const server = (result as { server?: unknown }).server;
  if (!server || typeof server !== "object") return undefined;
  const name = (server as { name?: unknown }).name;
  if (typeof name !== "string") return undefined;
  const version = (server as { version?: unknown }).version;
  const ide = (server as { ide?: unknown }).ide;
  return {
    name,
    version: typeof version === "string" ? version : undefined,
    ide: typeof ide === "string" ? ide : undefined,
  };
}
