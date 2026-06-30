// ABOUTME: Hosts the local authenticated WebSocket server used by IDE extensions and sidecars.
// ABOUTME: Sends JSON-RPC selection notifications while isolating individual socket failures.
import { createServer, type Server } from "node:http";
import WebSocket, { WebSocketServer } from "ws";
import {
  AUTH_HEADER,
  PROTOCOL_VERSION,
  type EditorSelectionSnapshot,
  type IdeSource,
  type InitializeResult,
} from "./protocol.js";
import { isJsonRpcRequest } from "./schema.js";
import { logExtensionError } from "./errors.js";
import { decodeRawData } from "./ws.js";

export class IdeWebSocketServer {
  private httpServer?: Server;
  private wss?: WebSocketServer;
  private readonly sockets = new Set<WebSocket>();

  constructor(
    private readonly authToken: string,
    private readonly serverInfo: { name: string; version?: string; ide?: IdeSource },
    private readonly getInitialSelection?: () => EditorSelectionSnapshot | undefined,
  ) {}

  get port(): number {
    const address = this.httpServer?.address();
    if (!address || typeof address === "string") return 0;
    return address.port;
  }

  get clientCount(): number {
    return this.openSockets.length;
  }

  async start(): Promise<number> {
    this.httpServer = createServer();
    this.wss = new WebSocketServer({
      server: this.httpServer,
      verifyClient: ({ req }, done) => {
        const header = req.headers[AUTH_HEADER];
        const token = Array.isArray(header) ? header[0] : header;
        done(token === this.authToken, token === this.authToken ? undefined : 401, "Unauthorized");
      },
    });

    this.wss.on("connection", (socket) => {
      this.sockets.add(socket);
      socket.on("close", () => this.sockets.delete(socket));
      socket.on("error", () => this.sockets.delete(socket));
      socket.on("message", (raw) => {
        try {
          this.handleMessage(socket, decodeRawData(raw));
        } catch (error) {
          logExtensionError("IDE WebSocket server message", error);
          this.sockets.delete(socket);
          socket.close();
        }
      });
    });

    await new Promise<void>((resolve, reject) => {
      this.httpServer!.once("error", reject);
      this.httpServer!.listen(0, "127.0.0.1", () => {
        this.httpServer!.off("error", reject);
        resolve();
      });
    });

    return this.port;
  }

  broadcast(value: unknown): void {
    let text: string;
    try {
      text = JSON.stringify(value);
    } catch (error) {
      logExtensionError("IDE WebSocket server broadcast serialization", error);
      return;
    }

    for (const socket of this.openSockets) this.sendText(socket, text, "broadcast");
  }

  sendToFirstClient(value: unknown): boolean {
    const [socket] = this.openSockets;
    if (!socket) return false;
    let text: string;
    try {
      text = JSON.stringify(value);
    } catch (error) {
      logExtensionError("IDE WebSocket server send serialization", error);
      return false;
    }
    return this.sendText(socket, text, "targeted send");
  }

  async stop(): Promise<void> {
    for (const socket of this.sockets) socket.close();
    this.sockets.clear();
    await Promise.all([
      new Promise<void>((resolve) => this.wss?.close(() => resolve()) ?? resolve()),
      new Promise<void>((resolve) => this.httpServer?.close(() => resolve()) ?? resolve()),
    ]);
  }

  private handleMessage(socket: WebSocket, text: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      return;
    }

    if (!isJsonRpcRequest(parsed)) return;
    if (parsed.method !== "initialize") return;

    const ide = this.serverInfo.ide ?? "vscode";
    const result: InitializeResult = {
      protocolVersion: PROTOCOL_VERSION,
      server: {
        name: this.serverInfo.name,
        version: this.serverInfo.version,
        ide,
      },
    };

    this.sendValue(socket, { jsonrpc: "2.0", id: parsed.id, result }, "initialize response");

    const snapshot = this.getInitialSelection?.();
    this.sendValue(
      socket,
      {
        jsonrpc: "2.0",
        method: snapshot ? "selection_changed" : "selection_cleared",
        params: snapshot
          ? {
              ...snapshot,
              receivedAt: Date.now(),
            }
          : {
              source: ide,
              reason: "no-active-editor",
              receivedAt: Date.now(),
            },
      },
      "initial selection",
    );
  }

  private sendValue(socket: WebSocket, value: unknown, label: string): boolean {
    let text: string;
    try {
      text = JSON.stringify(value);
    } catch (error) {
      logExtensionError(`IDE WebSocket server ${label} serialization`, error);
      return false;
    }
    return this.sendText(socket, text, label);
  }

  private sendText(socket: WebSocket, text: string, label: string): boolean {
    try {
      socket.send(text, (error) => {
        if (!error) return;
        logExtensionError(`IDE WebSocket server ${label}`, error);
        this.sockets.delete(socket);
        socket.close();
      });
      return true;
    } catch (error) {
      logExtensionError(`IDE WebSocket server ${label}`, error);
      this.sockets.delete(socket);
      socket.close();
      return false;
    }
  }

  private get openSockets(): WebSocket[] {
    return [...this.sockets].filter((socket) => socket.readyState === WebSocket.OPEN);
  }
}
