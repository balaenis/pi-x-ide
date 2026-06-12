import WebSocket from "ws";
import {
  AUTH_HEADER,
  PROTOCOL_VERSION,
  type AtMentionedParams,
  type EditorSelectionSnapshot,
  type JsonRpcResponse,
  type LockFileCandidate,
  type SelectionChangedParams,
  type SelectionClearedParams,
} from "../shared/protocol";
import { isAtMentionedParams, isSelectionChangedParams, isSelectionClearedParams } from "../shared/schema";
import { decodeRawData } from "../shared/ws";

export const IDE_CONNECT_TIMEOUT_MS = 5_000;

export class IdeConnectionTimeoutError extends Error {
  constructor(readonly candidate: LockFileCandidate) {
    super(`Timed out connecting to ${candidate.lock.name} at ${candidate.lock.host}:${candidate.lock.port}`);
    this.name = "IdeConnectionTimeoutError";
  }
}

export interface IdeConnectionCallbacks {
  onConnected?: (server: { name: string; version?: string; ide?: string }) => void;
  onDisconnected?: (reason: string) => void;
  onSelectionChanged?: (snapshot: EditorSelectionSnapshot) => void;
  onSelectionCleared?: (params: SelectionClearedParams) => void;
  onAtMentioned?: (params: AtMentionedParams) => void;
  onError?: (error: Error) => void;
}

export class IdeConnection {
  private socket?: WebSocket;
  private nextId = 1;
  private closedByUser = false;

  constructor(
    readonly candidate: LockFileCandidate,
    private readonly cwd: string,
    private readonly callbacks: IdeConnectionCallbacks,
  ) {}

  get isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  async connect(timeoutMs = IDE_CONNECT_TIMEOUT_MS): Promise<void> {
    this.closedByUser = false;
    const { lock } = this.candidate;
    const socket = new WebSocket(`ws://${lock.host}:${lock.port}`, {
      handshakeTimeout: timeoutMs + 1_000,
      headers: {
        [AUTH_HEADER]: lock.authToken,
      },
    });
    this.socket = socket;

    socket.on("message", (raw) => this.handleMessage(decodeRawData(raw)));
    socket.on("close", (_code, reason) => {
      if (this.socket !== socket) return;
      this.socket = undefined;
      this.callbacks.onDisconnected?.(reason.toString("utf8") || (this.closedByUser ? "closed" : "disconnected"));
    });
    socket.on("error", (error) => {
      if (this.socket === socket) this.callbacks.onError?.(error);
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        if (this.socket === socket) this.socket = undefined;
        socket.terminate();
        reject(new IdeConnectionTimeoutError(this.candidate));
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
          client: { name: "pi-x-ide", version: "0.1.0" },
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
      if (server) this.callbacks.onConnected?.(server);
      return;
    }

    if (!isNotification(parsed)) return;
    if (parsed.method === "selection_changed" && isSelectionChangedParams(parsed.params)) {
      this.callbacks.onSelectionChanged?.(withReceivedAt(parsed.params));
    } else if (parsed.method === "selection_cleared" && isSelectionClearedParams(parsed.params)) {
      this.callbacks.onSelectionCleared?.(withReceivedAt(parsed.params));
    } else if (parsed.method === "at_mentioned" && isAtMentionedParams(parsed.params)) {
      const params = withReceivedAt(parsed.params);
      this.callbacks.onAtMentioned?.(params);
    }
  }
}

function withReceivedAt<T extends SelectionChangedParams | SelectionClearedParams>(params: T): T {
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
