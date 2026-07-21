// ABOUTME: Implements the Pi-side WebSocket client that receives IDE selection notifications.
// ABOUTME: Contains callback dispatch boundaries so IDE messages cannot crash the Pi process.
import WebSocket from "ws";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { EXT_CONFIG_NAME } from "../shared/config.js";
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
} from "../shared/protocol.js";
import {
  isAtMentionedParams,
  isDiagnosticFixRequestedParams,
  isSelectionChangedParams,
  isSelectionClearedParams,
} from "../shared/schema.js";
import { IdeConnectTimeoutError } from "../shared/effect-errors.js";
import { toError, logExtensionError } from "../shared/errors.js";
import { formatRangeMention } from "../shared/format.js";
import { normalizeEditorSelectionSnapshotForHost } from "../shared/platform.js";
import { decodeRawData } from "../shared/ws.js";
import { resolveIdeHost } from "./ide-host.js";

export const IDE_CONNECT_TIMEOUT_MS = 5_000;
const IDE_CONNECT_HANDSHAKE_TIMEOUT_PADDING_MS = 1_000;

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
    const exit = await Effect.runPromiseExit(this.connectEffect(timeoutMs));
    if (Exit.isSuccess(exit)) return;

    // Prefer Cause.squash so tagged timeouts and socket errors surface as a single unknown.
    const failure = Cause.squash(exit.cause);
    if (isIdeConnectTimeoutError(failure)) {
      // Map tagged timeout → class error so instanceof checks in index.ts / tests keep working.
      throw new IdeConnectionTimeoutError(this.candidate, failure.host);
    }
    throw failure instanceof Error ? failure : toError(failure);
  }

  /** Internal Effect: resolve host, open socket, race open vs timeout, then initialize. */
  private connectEffect(timeoutMs: number): Effect.Effect<void, IdeConnectTimeoutError | Error, never> {
    return Effect.gen(this, function* () {
      this.closedByUser = false;
      const { lock } = this.candidate;
      const resolvedHost = yield* Effect.tryPromise({
        try: () => (this.options.resolveHost ?? resolveIdeHost)(lock),
        catch: (cause) => toError(cause, "resolve host"),
      });

      const socket = new WebSocket(`ws://${resolvedHost}:${lock.port}`, {
        handshakeTimeout: timeoutMs + IDE_CONNECT_HANDSHAKE_TIMEOUT_PADDING_MS,
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

      yield* Effect.async<void, IdeConnectTimeoutError | Error>((resume) => {
        let settled = false;
        const finish = (result: Effect.Effect<void, IdeConnectTimeoutError | Error>) => {
          if (settled) return;
          settled = true;
          cleanup();
          resume(result);
        };
        const timeout = setTimeout(() => {
          // Match main order: detach open/error listeners before terminate so a
          // follow-on socket error cannot replace the timeout rejection.
          cleanup();
          if (this.socket === socket) this.socket = undefined;
          socket.terminate();
          if (settled) return;
          settled = true;
          resume(
            Effect.fail(
              new IdeConnectTimeoutError({
                name: this.candidate.lock.name,
                host: resolvedHost,
                port: lock.port,
              }),
            ),
          );
        }, timeoutMs);
        const onOpen = () => {
          // Clear timer/listeners first (main parity), then initialize.
          finish(Effect.succeed(undefined));
          this.sendInitialize();
        };
        const onError = (error: Error) => {
          if (this.socket === socket) this.socket = undefined;
          finish(Effect.fail(error));
        };
        const cleanup = () => {
          clearTimeout(timeout);
          socket.off("open", onOpen);
          socket.off("error", onError);
        };
        socket.once("open", onOpen);
        socket.once("error", onError);
        return Effect.sync(cleanup);
      });
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

function isIdeConnectTimeoutError(value: unknown): value is IdeConnectTimeoutError {
  return value instanceof IdeConnectTimeoutError;
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
