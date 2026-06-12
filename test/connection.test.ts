import assert from "node:assert/strict";
import { createServer, type AddressInfo, type Socket } from "node:net";
import test from "node:test";
import { IdeConnection, IdeConnectionTimeoutError } from "../src/pi/connection";
import {
  formatReconnectLimitMessage,
  MAX_RECONNECT_ATTEMPTS,
  recordReconnectAttempt,
  resetReconnectState,
} from "../src/pi/reconnect";
import { createRuntime } from "../src/pi/state";
import type { LockFileCandidate } from "../src/shared/protocol";

void test("caps reconnect attempts at three per candidate", () => {
  const runtime = createRuntime();
  const candidate = createCandidate({ port: 41001 });

  assert.equal(recordReconnectAttempt(runtime, candidate), 1);
  assert.equal(recordReconnectAttempt(runtime, candidate), 2);
  assert.equal(recordReconnectAttempt(runtime, candidate), MAX_RECONNECT_ATTEMPTS);
  assert.equal(recordReconnectAttempt(runtime, candidate), undefined);
  assert.match(formatReconnectLimitMessage(candidate), /after 3 attempts/);
  assert.match(formatReconnectLimitMessage(candidate), /\/ide/);

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
