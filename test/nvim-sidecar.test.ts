// ABOUTME: Exercises the Neovim sidecar public lifecycle through startNvimSidecar().
// ABOUTME: Covers lock creation, workspace refresh, custom-directory isolation, and stop.
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import WebSocket from "ws";
import { startNvimSidecar } from "../src/nvim/sidecar.js";
import { parseNvimSidecarMessage } from "../src/nvim/sidecar-schema.js";
import { CONFIG_DIR_NAME, EXT_CONFIG_NAME } from "../src/shared/config.js";
import { AUTH_HEADER, type IdeLockFile } from "../src/shared/protocol.js";

const TEST_SIDECAR_HEARTBEAT_INTERVAL_MS = 40;
const TEST_SIDECAR_POLL_MS = 10;
const TEST_SIDECAR_TIMEOUT_MS = 2_000;

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(predicate: () => Promise<boolean>, timeoutMs = TEST_SIDECAR_TIMEOUT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(TEST_SIDECAR_POLL_MS);
  }
  throw new Error("Timed out waiting for nvim sidecar condition");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

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
          params: { protocolVersion: 1, client: { name: EXT_CONFIG_NAME, version: "test" }, cwd: "/repo" },
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

void test(
  "restores the sidecar lock with latest workspace only in its custom directory",
  { concurrency: false },
  async () => {
    const fakeHome = await mkdtemp(join(tmpdir(), "pi-x-ide-nvim-home-"));
    const lockDir = await mkdtemp(join(tmpdir(), "pi-x-ide-nvim-custom-lock-"));
    const defaultLockDir = join(fakeHome, CONFIG_DIR_NAME, EXT_CONFIG_NAME, "lock");
    const previousHome = process.env.HOME;
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const latestFolders = ["/repo", "/other"];
    process.env.HOME = fakeHome;

    let handle: Awaited<ReturnType<typeof startNvimSidecar>> | undefined;
    try {
      const sidecar = await startNvimSidecar({
        workspaceFolders: ["/repo"],
        lockDir,
        stdin,
        stdout,
        stderr,
        heartbeatIntervalMs: TEST_SIDECAR_HEARTBEAT_INTERVAL_MS,
      });
      handle = sidecar;
      assert.equal(await pathExists(defaultLockDir), false);

      stdin.write(JSON.stringify({ type: "workspace_changed", workspaceFolders: latestFolders }) + "\n");
      await waitUntil(async () => {
        try {
          const current = JSON.parse(await readFile(sidecar.lockFilePath, "utf8")) as IdeLockFile;
          return current.workspaceFolders.join("\0") === latestFolders.join("\0");
        } catch {
          return false;
        }
      });

      const beforeDelete = JSON.parse(await readFile(sidecar.lockFilePath, "utf8")) as IdeLockFile;
      await rm(sidecar.lockFilePath, { force: true });
      await waitUntil(() => pathExists(sidecar.lockFilePath));
      assert.equal(await pathExists(defaultLockDir), false);

      const restored = JSON.parse(await readFile(sidecar.lockFilePath, "utf8")) as IdeLockFile;
      assert.equal(restored.ide, beforeDelete.ide);
      assert.equal(restored.port, beforeDelete.port);
      assert.equal(restored.pid, beforeDelete.pid);
      assert.equal(restored.authToken, beforeDelete.authToken);
      assert.equal(restored.createdAt, beforeDelete.createdAt);
      assert.deepEqual(restored.workspaceFolders, latestFolders);

      await sidecar.stop();
      assert.equal(await pathExists(sidecar.lockFilePath), false);
      await delay(TEST_SIDECAR_HEARTBEAT_INTERVAL_MS * 2 + TEST_SIDECAR_POLL_MS);
      assert.equal(await pathExists(sidecar.lockFilePath), false);
      assert.equal(await pathExists(defaultLockDir), false);
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      await handle?.stop();
      stdin.destroy();
      stdout.destroy();
      stderr.destroy();
      await rm(lockDir, { recursive: true, force: true });
      await rm(fakeHome, { recursive: true, force: true });
    }
  },
);

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
