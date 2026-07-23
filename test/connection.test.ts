// ABOUTME: Verifies Pi-side IDE connection and reconnect behavior over WebSocket.
// ABOUTME: Covers callback error containment so IDE messages cannot crash Pi.
import assert from "node:assert/strict";
import { createServer, type AddressInfo, type Socket } from "node:net";
import test from "node:test";
import * as Effect from "effect/Effect";
import { WebSocketServer } from "ws";
import { IdeConnection, IdeConnectionTimeoutError } from "../src/pi/connection.js";
import { PI_X_IDE_HOST_OVERRIDE_ENV, parseDefaultGateway, resolveIdeHost } from "../src/pi/ide-host.js";
import {
  formatReconnectLimitMessage,
  MAX_RECONNECT_ATTEMPTS,
  RECONNECT_DELAY_MS,
  recordReconnectAttempt,
  resetReconnectState,
  scheduleReconnect,
  stopReconnectScheduling,
} from "../src/pi/reconnect.js";
import { runPiEffect } from "../src/pi/effect-boundary.js";
import { createRuntime } from "../src/pi/state.js";
import {
  AUTH_HEADER,
  PROTOCOL_VERSION,
  type AtMentionedParams,
  type DiagnosticFixRequestedParams,
  type EditorSelectionSnapshot,
  type LockFileCandidate,
} from "../src/shared/protocol.js";
import { decodeRawData } from "../src/shared/ws.js";
import { formatExtensionError, setExtensionErrorReporter } from "../src/shared/errors.js";

void test("runPiEffect contains failures and updates runtime error status", async () => {
  const runtime = createRuntime();
  const messages: string[] = [];
  setExtensionErrorReporter((scope, error) => {
    messages.push(formatExtensionError(scope, error));
  });
  try {
    const failed = await runPiEffect("pi-effect-fail", runtime, Effect.fail(new Error("boom")));
    assert.equal(failed, undefined);
    assert.equal(runtime.connectionStatus, "error");
    assert.match(runtime.connectionMessage ?? "", /pi-effect-fail: boom/);
    assert.ok(messages.some((message) => message.includes("pi-effect-fail") && message.includes("boom")));

    const ok = await runPiEffect("pi-effect-ok", runtime, Effect.succeed(7));
    assert.equal(ok, 7);
  } finally {
    setExtensionErrorReporter(undefined);
  }
});

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

void test("scheduleReconnect fiber lifecycle respects stop, disable, and generation", async () => {
  assert.equal(RECONNECT_DELAY_MS, 2_000);

  const runtime = createRuntime();
  runtime.sessionGeneration = 1;
  let calls = 0;
  const bump = () => {
    calls += 1;
    return Promise.resolve();
  };
  scheduleReconnect(runtime, bump);
  assert.ok(runtime.reconnectFiber);
  // Second schedule while fiber is active is a no-op.
  scheduleReconnect(runtime, bump);
  assert.equal(runtime.reconnectAttempts, 1);

  stopReconnectScheduling(runtime);
  assert.equal(runtime.reconnectFiber, undefined);
  await sleep(50);
  assert.equal(calls, 0);

  // Disabled runtime never schedules.
  runtime.enabled = false;
  scheduleReconnect(runtime, bump);
  assert.equal(runtime.reconnectFiber, undefined);
  runtime.enabled = true;

  // Generation bump after schedule cancels work via interrupt path.
  let observedGeneration: number | undefined;
  scheduleReconnect(runtime, (scheduledGeneration) => {
    observedGeneration = scheduledGeneration;
    calls += 1;
    return Promise.resolve();
  });
  assert.ok(runtime.reconnectFiber);
  runtime.sessionGeneration += 1;
  stopReconnectScheduling(runtime);
  assert.equal(runtime.reconnectFiber, undefined);
  assert.equal(calls, 0);
  assert.equal(observedGeneration, undefined);

  // Exhausted attempts set error status without creating a fiber.
  resetReconnectState(runtime);
  runtime.currentCandidate = createCandidate({ port: 41003 });
  assert.equal(recordReconnectAttempt(runtime, runtime.currentCandidate), 1);
  assert.equal(recordReconnectAttempt(runtime, runtime.currentCandidate), 2);
  assert.equal(recordReconnectAttempt(runtime, runtime.currentCandidate), 3);
  scheduleReconnect(runtime, bump);
  assert.equal(runtime.reconnectFiber, undefined);
  assert.equal(runtime.connectionStatus, "error");
  assert.match(runtime.connectionMessage ?? "", /after 3 attempts/);
  assert.equal(calls, 0);
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

void test("resolves IDE hosts from override, WSL gateway, and lock fallback", async () => {
  const lock = createCandidate({ host: "127.0.0.1", runningInWindows: true }).lock;
  const runCommand = () => Promise.resolve({ stdout: "default via 172.30.96.1 dev eth0 proto kernel\n" });

  assert.equal(parseDefaultGateway("default via 172.30.96.1 dev eth0\n"), "172.30.96.1");
  assert.equal(
    await resolveIdeHost(lock, {
      env: { [PI_X_IDE_HOST_OVERRIDE_ENV]: "10.0.0.12", WSL_DISTRO_NAME: "Ubuntu" },
      runCommand,
      tcpProbe: () => Promise.resolve(true),
    }),
    "10.0.0.12",
  );
  assert.equal(
    await resolveIdeHost(lock, {
      env: { WSL_DISTRO_NAME: "Ubuntu" },
      runCommand,
      tcpProbe: (host, port, timeoutMs) =>
        Promise.resolve(host === "172.30.96.1" && port === lock.port && timeoutMs === 500),
    }),
    "172.30.96.1",
  );
  assert.equal(
    await resolveIdeHost(lock, {
      env: { WSL_DISTRO_NAME: "Ubuntu" },
      runCommand,
      tcpProbe: () => Promise.resolve(false),
    }),
    "127.0.0.1",
  );
  assert.equal(
    await resolveIdeHost({ ...lock, runningInWindows: false }, { env: { WSL_DISTRO_NAME: "Ubuntu" } }),
    "127.0.0.1",
  );
});

void test("connects using resolved host while keeping WebSocket auth", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  const connected = new Promise<void>((resolve, reject) => {
    server.once("connection", (socket, request) => {
      try {
        assert.equal(request.headers[AUTH_HEADER], "token");
        socket.close();
        resolve();
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
  await new Promise<void>((resolve) => server.once("listening", resolve));

  try {
    const address = server.address() as AddressInfo;
    const connection = new IdeConnection(
      createCandidate({ host: "192.0.2.1", port: address.port }),
      "/repo",
      {},
      { resolveHost: () => Promise.resolve("127.0.0.1") },
    );
    await connection.connect();
    await connected;
    connection.disconnect();
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
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

void test("normalizes selection notifications before callbacks", async () => {
  const payload: EditorSelectionSnapshot = {
    source: "jetbrains",
    filePath: "\\\\wsl.localhost\\Ubuntu\\home\\julian\\repo\\src\\a.ts",
    workspaceFolder: "\\\\wsl.localhost\\Ubuntu\\home\\julian\\repo",
    ranges: [
      {
        text: "hello",
        selection: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
      },
    ],
  };
  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
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
            result: { protocolVersion: PROTOCOL_VERSION, server: { name: "Test IDE", ide: "jetbrains" } },
          }),
        );
        socket.send(JSON.stringify({ jsonrpc: "2.0", method: "selection_changed", params: payload }));
        socket.send(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "at_mentioned",
            params: { ...payload, rangeText: "@\\\\wsl.localhost\\Ubuntu\\home\\julian\\repo\\src\\a.ts#L1" },
          }),
        );
      });
    });

    const address = wss.address() as AddressInfo;
    let selectionResolve!: (snapshot: EditorSelectionSnapshot) => void;
    const selection = new Promise<EditorSelectionSnapshot>((resolve) => {
      selectionResolve = resolve;
    });
    let mentionResolve!: (params: AtMentionedParams) => void;
    const mention = new Promise<AtMentionedParams>((resolve) => {
      mentionResolve = resolve;
    });
    connection = new IdeConnection(
      createCandidate({ ide: "jetbrains", port: address.port }),
      "/home/julian/repo",
      { onAtMentioned: mentionResolve, onSelectionChanged: selectionResolve },
      { env: { WSL_DISTRO_NAME: "Ubuntu" } },
    );

    await connection.connect();
    const snapshot = await withTimeout(selection, 500, "timed out waiting for selection notification");
    assert.equal(snapshot.filePath, "/home/julian/repo/src/a.ts");
    assert.equal(snapshot.workspaceFolder, "/home/julian/repo");
    const atMentioned = await withTimeout(mention, 500, "timed out waiting for at mentioned notification");
    assert.equal(atMentioned.filePath, "/home/julian/repo/src/a.ts");
    assert.equal(atMentioned.workspaceFolder, "/home/julian/repo");
    assert.equal(atMentioned.rangeText, "@src/a.ts#L1");
  } finally {
    connection?.disconnect();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
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
