import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import WebSocket from "ws";
import { startNvimSidecar } from "../src/nvim/sidecar";
import { parseNvimSidecarMessage } from "../src/nvim/sidecar-schema";
import { AUTH_HEADER, type IdeLockFile } from "../src/shared/protocol";

void test("validates nvim sidecar messages", () => {
  assert.deepEqual(parseNvimSidecarMessage({ type: "shutdown" }), { type: "shutdown" });
  assert.equal(
    parseNvimSidecarMessage({ type: "workspace_changed", workspaceFolders: ["/repo"] })?.type,
    "workspace_changed",
  );
  assert.equal(parseNvimSidecarMessage({ type: "workspace_changed", workspaceFolders: [123] }), undefined);
});

void test("starts sidecar, writes lock file, initializes websocket, and forwards selection", async () => {
  const lockDir = await mkdtemp(join(tmpdir(), "pi-x-ide-nvim-lock-"));
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();

  const handle = await startNvimSidecar({
    workspaceFolders: ["/repo"],
    lockDir,
    stdin,
    stdout,
    stderr,
  });

  try {
    const lock = JSON.parse(await readFile(handle.lockFilePath, "utf8")) as IdeLockFile;
    assert.equal(lock.ide, "nvim");
    assert.equal(lock.name, "Neovim");
    assert.deepEqual(lock.workspaceFolders, ["/repo"]);
    assert.match(lock.authToken, /^[a-f0-9]{64}$/);

    const socket = await connect(lock.port, lock.authToken);
    try {
      const messages = createMessageCollector(socket);
      socket.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: 1, client: { name: "pi-x-ide", version: "test" }, cwd: "/repo" },
        }),
      );

      const initialize = JSON.parse(await messages.next()) as { result: { server: { ide: string } } };
      assert.equal(initialize.result.server.ide, "nvim");

      const initialSelection = JSON.parse(await messages.next()) as { method: string; params: { source: string } };
      assert.equal(initialSelection.method, "selection_cleared");
      assert.equal(initialSelection.params.source, "nvim");

      stdin.write(
        JSON.stringify({
          type: "selection_changed",
          snapshot: {
            source: "nvim",
            filePath: "/repo/src/main.ts",
            workspaceFolder: "/repo",
            ranges: [
              {
                text: "const x = 1;",
                selection: { start: { line: 0, character: 0 }, end: { line: 0, character: 12 } },
              },
            ],
          },
        }) + "\n",
      );

      const selection = JSON.parse(await messages.next()) as {
        method: string;
        params: { source: string; filePath: string; ranges: Array<{ text: string }> };
      };
      assert.equal(selection.method, "selection_changed");
      assert.equal(selection.params.source, "nvim");
      assert.equal(selection.params.filePath, "/repo/src/main.ts");
      assert.equal(selection.params.ranges[0]?.text, "const x = 1;");
    } finally {
      socket.close();
    }
  } finally {
    await handle.stop();
    stdin.destroy();
    stdout.destroy();
    stderr.destroy();
    await rm(lockDir, { recursive: true, force: true });
  }
});

function connect(port: number, token: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`, { headers: { [AUTH_HEADER]: token } });
    const timeout = setTimeout(() => {
      cleanup();
      socket.close();
      reject(new Error(`Timed out connecting to nvim sidecar on port ${port}`));
    }, 2_000);
    const onOpen = () => {
      cleanup();
      resolve(socket);
    };
    const onError = (error: Error) => {
      cleanup();
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

function createMessageCollector(socket: WebSocket): { next: () => Promise<string> } {
  const queue: string[] = [];
  const waiters: Array<(value: string) => void> = [];

  socket.on("message", (raw) => {
    const message = decodeRawData(raw);
    const waiter = waiters.shift();
    if (waiter) waiter(message);
    else queue.push(message);
  });

  return {
    next: () =>
      new Promise((resolve, reject) => {
        const queued = queue.shift();
        if (queued !== undefined) {
          resolve(queued);
          return;
        }
        const timeout = setTimeout(() => {
          const index = waiters.indexOf(resolve);
          if (index >= 0) waiters.splice(index, 1);
          reject(new Error("Timed out waiting for nvim sidecar WebSocket message"));
        }, 2_000);
        waiters.push((value) => {
          clearTimeout(timeout);
          resolve(value);
        });
      }),
  };
}

function decodeRawData(raw: WebSocket.RawData): string {
  if (Buffer.isBuffer(raw)) return raw.toString("utf8");
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString("utf8");
  return Buffer.concat(raw).toString("utf8");
}
