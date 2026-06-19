// ABOUTME: Verifies Pi-side IDE connection and reconnect behavior over WebSocket.
// ABOUTME: Covers callback error containment so IDE messages cannot crash Pi.
import assert from "node:assert/strict";
import { createServer, type AddressInfo, type Socket } from "node:net";
import test from "node:test";
import { WebSocketServer } from "ws";
import { IdeConnection, IdeConnectionTimeoutError } from "../src/pi/connection";
import {
  formatReconnectLimitMessage,
  MAX_RECONNECT_ATTEMPTS,
  recordReconnectAttempt,
  resetReconnectState,
} from "../src/pi/reconnect";
import { createRuntime } from "../src/pi/state";
import {
  AUTH_HEADER,
  PROTOCOL_VERSION,
  type DiagnosticFixRequestedParams,
  type LockFileCandidate,
} from "../src/shared/protocol";
import { decodeRawData } from "../src/shared/ws";

void test("caps reconnect attempts at three per candidate", () => {
  const runtime = createRuntime();
  const candidate = createCandidate({ port: 41001 });

  assert.equal(recordReconnectAttempt(runtime, candidate), 1);
  assert.equal(recordReconnectAttempt(runtime, candidate), 2);
  assert.equal(recordReconnectAttempt(runtime, candidate), MAX_RECONNECT_ATTEMPTS);
  assert.equal(recordReconnectAttempt(runtime, candidate), undefined);
  assert.match(formatReconnectLimitMessage(candidate), /after 3 attempts/);

  const nextCandidate = createCandidate({ port: 41002 });
  assert.equal(recordReconnectAttempt(runtime, nextCandidate), 1);

  resetReconnectState(runtime);
  assert.equal(recordReconnectAttempt(runtime, candidate), 1);
});

void test("times out stalled websocket handshakes", async () => {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("data", () => {
      // Keep the TCP connection open but never send an HTTP/WebSocket handshake response.
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const address = server.address() as AddressInfo;
    const candidate = createCandidate({ port: address.port });
    let disconnects = 0;
    const connection = new IdeConnection(candidate, "/repo", {
      onDisconnected: () => {
        disconnects += 1;
      },
    });

    await assert.rejects(
      () => connection.connect(100),
      (error: unknown) => error instanceof IdeConnectionTimeoutError && /timed out/i.test(error.message),
    );
    assert.equal(connection.isOpen, false);
    assert.equal(disconnects, 0);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

void test("dispatches diagnostic fix requested notifications", async () => {
  const payload: DiagnosticFixRequestedParams = {
    source: "vscode",
    filePath: "/repo/src/main.ts",
    workspaceFolder: "/repo",
    triggerRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
    diagnostics: [
      {
        severity: "warning",
        message: "Unexpected any.",
        source: "eslint",
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
        selectedText: "data",
        contextLines: [{ line: 0, text: "const data: any = {};", isPrimary: true }],
      },
    ],
  };
  const wss = new WebSocketServer({
    host: "127.0.0.1",
    port: 0,
    verifyClient: ({ req }, done) => {
      done(req.headers[AUTH_HEADER] === "token");
    },
  });

  await new Promise<void>((resolve) => wss.once("listening", resolve));
  let connection: IdeConnection | undefined;

  try {
    wss.on("connection", (socket) => {
      socket.on("message", (raw) => {
        const request = JSON.parse(decodeRawData(raw)) as { id: number | string };
        socket.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            result: {
              protocolVersion: PROTOCOL_VERSION,
              server: { name: "Test IDE", ide: "vscode" },
            },
          }),
        );
        socket.send(JSON.stringify({ jsonrpc: "2.0", method: "diagnostic_fix_requested", params: payload }));
      });
    });

    const address = wss.address() as AddressInfo;
    let receivedResolve!: (params: DiagnosticFixRequestedParams) => void;
    const received = new Promise<DiagnosticFixRequestedParams>((resolve) => {
      receivedResolve = resolve;
    });
    const candidateConnection = new IdeConnection(createCandidate({ port: address.port }), "/repo", {
      onDiagnosticFixRequested: receivedResolve,
    });
    connection = candidateConnection;

    await candidateConnection.connect();
    const params = await withTimeout(received, 500, "timed out waiting for diagnostic fix notification");
    assert.equal(params.filePath, "/repo/src/main.ts");
    assert.equal(params.diagnostics[0]?.severity, "warning");
    assert.equal(params.diagnostics[0]?.message, "Unexpected any.");
    assert.equal(typeof params.receivedAt, "number");
  } finally {
    connection?.disconnect();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  }
});

void test("reports callback failures without throwing from websocket message handling", async () => {
  const wss = new WebSocketServer({
    host: "127.0.0.1",
    port: 0,
    verifyClient: ({ req }, done) => {
      done(req.headers[AUTH_HEADER] === "token");
    },
  });

  await new Promise<void>((resolve) => wss.once("listening", resolve));
  let connection: IdeConnection | undefined;

  try {
    wss.on("connection", (socket) => {
      socket.on("message", () => {
        socket.send(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "selection_changed",
            params: {
              source: "vscode",
              filePath: "/repo/src/main.ts",
              workspaceFolder: "/repo",
              ranges: [
                {
                  text: "const value = 1;",
                  selection: { start: { line: 0, character: 0 }, end: { line: 0, character: 16 } },
                },
              ],
            },
          }),
        );
      });
    });

    const address = wss.address() as AddressInfo;
    let reportedResolve!: (error: Error) => void;
    const reported = new Promise<Error>((resolve) => {
      reportedResolve = resolve;
    });
    const candidateConnection = new IdeConnection(createCandidate({ port: address.port }), "/repo", {
      onSelectionChanged: () => {
        throw new Error("selection callback failed");
      },
      onError: (error) => reportedResolve(error),
    });
    connection = candidateConnection;

    await candidateConnection.connect();
    const error = await withTimeout(reported, 500, "timed out waiting for callback error report");
    assert.match(error.message, /selection changed callback: selection callback failed/);
    assert.equal(candidateConnection.isOpen, true);
  } finally {
    connection?.disconnect();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  }
});

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

function createCandidate(overrides: Partial<LockFileCandidate["lock"]> = {}): LockFileCandidate {
  return {
    path: "/tmp/pi-x-ide-stalled.lock",
    mtimeMs: Date.now(),
    matchLength: 1,
    workspaceFolder: "/repo",
    lock: {
      version: 1,
      ide: "nvim",
      name: "Neovim",
      transport: "ws",
      host: "127.0.0.1",
      port: 41000,
      authToken: "token",
      workspaceFolders: ["/repo"],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...overrides,
    },
  };
}
