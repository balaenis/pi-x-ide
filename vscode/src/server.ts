import { createServer, type Server } from "node:http";
import WebSocket, { WebSocketServer } from "ws";
import {
  AUTH_HEADER,
  PROTOCOL_VERSION,
  type EditorSelectionSnapshot,
  type InitializeResult,
} from "../../src/shared/protocol";
import { isJsonRpcRequest } from "../../src/shared/schema";
import { decodeRawData } from "../../src/shared/ws";

export class IdeWebSocketServer {
  private httpServer?: Server;
  private wss?: WebSocketServer;
  private readonly sockets = new Set<WebSocket>();

  constructor(
    private readonly authToken: string,
    private readonly serverInfo: { name: string; version?: string },
    private readonly getInitialSelection?: () => EditorSelectionSnapshot | undefined,
  ) {}

  get port(): number {
    const address = this.httpServer?.address();
    if (!address || typeof address === "string") return 0;
    return address.port;
  }

  get clientCount(): number {
    return this.sockets.size;
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
      socket.on("message", (raw) => this.handleMessage(socket, decodeRawData(raw)));
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
    const text = JSON.stringify(value);
    for (const socket of this.sockets) {
      if (socket.readyState === WebSocket.OPEN) socket.send(text);
    }
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

    const result: InitializeResult = {
      protocolVersion: PROTOCOL_VERSION,
      server: {
        name: this.serverInfo.name,
        version: this.serverInfo.version,
        ide: "vscode",
      },
    };

    socket.send(JSON.stringify({ jsonrpc: "2.0", id: parsed.id, result }));

    const snapshot = this.getInitialSelection?.();
    if (snapshot) {
      socket.send(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "selection_changed",
          params: {
            ...snapshot,
            receivedAt: Date.now(),
          },
        }),
      );
    }
  }
}
