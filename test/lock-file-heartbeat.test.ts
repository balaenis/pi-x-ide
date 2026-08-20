// ABOUTME: Verifies the shared lock-file heartbeat scheduler through its public handle.
// ABOUTME: Covers timer recovery, explicit refresh, serialization, containment, and terminal drain.
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createAuthToken,
  createIdeLockFile,
  createIdeLockFilePath,
  refreshIdeLockFile,
  writeIdeLockFile,
} from "../src/shared/lock-file.js";
import { startLockFileHeartbeat } from "../src/shared/lock-file-heartbeat.js";
import type { IdeLockFile } from "../src/shared/protocol.js";

const TEST_HEARTBEAT_INTERVAL_MS = 40;
const TEST_HEARTBEAT_POLL_MS = 10;
const TEST_HEARTBEAT_TIMEOUT_MS = 2_000;
const TEST_LOCK_PORT = 48131;

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function isPromisePending(promise: Promise<void>): Promise<boolean> {
  let settled = false;
  void promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await Promise.resolve();
  return !settled;
}

async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = TEST_HEARTBEAT_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(TEST_HEARTBEAT_POLL_MS);
  }
  throw new Error("Timed out waiting for lock-file heartbeat condition");
}

async function lockFileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readLock(path: string): Promise<IdeLockFile> {
  return JSON.parse(await readFile(path, "utf8")) as IdeLockFile;
}

void test("restores an externally deleted lock until an idle heartbeat stops", async () => {
  const lockDir = await mkdtemp(join(tmpdir(), "pi-x-ide-heartbeat-"));
  const authToken = createAuthToken();
  const lockPath = createIdeLockFilePath("vscode", TEST_LOCK_PORT, process.pid, lockDir);
  let lock = createIdeLockFile({
    ide: "vscode",
    name: "Visual Studio Code",
    port: TEST_LOCK_PORT,
    authToken,
    workspaceFolders: ["/repo"],
    pid: process.pid,
  });
  await writeIdeLockFile(lockPath, lock, lockDir);
  const originalCreatedAt = lock.createdAt;
  const originalUpdatedAt = lock.updatedAt;

  const heartbeat = startLockFileHeartbeat(
    async () => {
      lock = refreshIdeLockFile(lock, lock.workspaceFolders);
      await writeIdeLockFile(lockPath, lock, lockDir);
    },
    { intervalMs: TEST_HEARTBEAT_INTERVAL_MS },
  );

  try {
    await rm(lockPath, { force: true });
    await waitUntil(() => lockFileExists(lockPath));

    const restored = await readLock(lockPath);
    assert.equal(restored.ide, "vscode");
    assert.equal(restored.port, TEST_LOCK_PORT);
    assert.equal(restored.pid, process.pid);
    assert.equal(restored.authToken, authToken);
    assert.equal(restored.createdAt, originalCreatedAt);
    assert.notEqual(restored.updatedAt, originalUpdatedAt);

    await rm(lockPath, { force: true });
    await heartbeat.refreshNow();
    const immediate = await readLock(lockPath);
    assert.equal(immediate.authToken, authToken);
    assert.equal(immediate.createdAt, originalCreatedAt);
    assert.notEqual(immediate.updatedAt, restored.updatedAt);

    const firstStop = heartbeat.stop();
    const secondStop = heartbeat.stop();
    assert.equal(firstStop, secondStop);
    await firstStop;

    await rm(lockPath, { force: true });
    await delay(TEST_HEARTBEAT_INTERVAL_MS * 2 + TEST_HEARTBEAT_POLL_MS);
    assert.equal(await lockFileExists(lockPath), false);

    const postStopRefresh = heartbeat.refreshNow();
    assert.equal(postStopRefresh, firstStop);
    await postStopRefresh;
    assert.equal(await lockFileExists(lockPath), false);
  } finally {
    await heartbeat.stop();
    await rm(lockDir, { recursive: true, force: true });
  }
});

void test("serializes explicit refreshes, skips busy ticks, and contains both request sources", async () => {
  const EXPLICIT_REFRESH_ERROR = new Error("explicit-refresh-failed");
  const TIMER_REFRESH_ERROR = new Error("timer-refresh-failed");
  const ON_ERROR_FAILURE = new Error("on-error-failed");

  const starts: number[] = [];
  const completions: number[] = [];
  const reportedErrors: unknown[] = [];
  const gates: Array<() => void> = [];
  let activeCount = 0;
  let maxActiveCount = 0;
  let invocation = 0;
  let timerSuccesses = 0;
  let phase: "explicit" | "timer-error" | "timer-success" = "explicit";

  const heartbeat = startLockFileHeartbeat(
    async () => {
      const id = invocation;
      invocation += 1;
      starts.push(id);
      activeCount += 1;
      maxActiveCount = Math.max(maxActiveCount, activeCount);
      try {
        if (phase === "explicit") {
          await new Promise<void>((resolve) => {
            gates.push(resolve);
          });
          if (id === 1) throw EXPLICIT_REFRESH_ERROR;
          return;
        }
        if (phase === "timer-error") {
          phase = "timer-success";
          throw TIMER_REFRESH_ERROR;
        }
        timerSuccesses += 1;
      } finally {
        activeCount -= 1;
        completions.push(id);
      }
    },
    {
      intervalMs: TEST_HEARTBEAT_INTERVAL_MS,
      onError: (error) => {
        reportedErrors.push(error);
        throw ON_ERROR_FAILURE;
      },
    },
  );

  try {
    const first = heartbeat.refreshNow();
    await waitUntil(() => starts.length === 1);
    const second = heartbeat.refreshNow();
    await delay(TEST_HEARTBEAT_INTERVAL_MS * 2 + TEST_HEARTBEAT_POLL_MS);
    assert.equal(starts.length, 1);
    assert.equal(maxActiveCount, 1);

    gates[0]?.();
    await first;
    await waitUntil(() => starts.length === 2);
    gates[1]?.();
    await second;

    assert.deepEqual(starts, [0, 1]);
    assert.deepEqual(completions, [0, 1]);
    assert.equal(maxActiveCount, 1);
    assert.equal(reportedErrors[0], EXPLICIT_REFRESH_ERROR);

    phase = "timer-error";
    await waitUntil(() => reportedErrors.includes(TIMER_REFRESH_ERROR));
    await waitUntil(() => timerSuccesses >= 1);
    assert.deepEqual(reportedErrors, [EXPLICIT_REFRESH_ERROR, TIMER_REFRESH_ERROR]);
    assert.equal(maxActiveCount, 1);
    assert.ok(starts.includes(2));
    assert.ok(starts.includes(3));
    await heartbeat.stop();
  } finally {
    await heartbeat.stop();
  }
});

void test("drains the accepted explicit queue before one terminal stop promise resolves", async () => {
  const SECOND_REFRESH_ERROR = new Error("queued-refresh-failed");
  const ON_ERROR_FAILURE = new Error("queued-on-error-failed");
  const lockDir = await mkdtemp(join(tmpdir(), "pi-x-ide-heartbeat-drain-"));
  const authToken = createAuthToken();
  const lockPath = createIdeLockFilePath("vscode", TEST_LOCK_PORT, process.pid, lockDir);
  let lock = createIdeLockFile({
    ide: "vscode",
    name: "Visual Studio Code",
    port: TEST_LOCK_PORT,
    authToken,
    workspaceFolders: ["/repo"],
    pid: process.pid,
  });
  await writeIdeLockFile(lockPath, lock, lockDir);

  const starts: number[] = [];
  const gates: Array<() => void> = [];
  let invocation = 0;
  let secondContainmentFinished = false;

  const heartbeat = startLockFileHeartbeat(
    async () => {
      const id = invocation;
      invocation += 1;
      starts.push(id);
      await new Promise<void>((resolve) => {
        gates.push(resolve);
      });
      if (id === 1) throw SECOND_REFRESH_ERROR;
      lock = refreshIdeLockFile(lock, lock.workspaceFolders);
      await writeIdeLockFile(lockPath, lock, lockDir);
    },
    {
      intervalMs: TEST_HEARTBEAT_INTERVAL_MS,
      onError: async (error) => {
        if (error !== SECOND_REFRESH_ERROR) throw error;
        await delay(TEST_HEARTBEAT_POLL_MS);
        secondContainmentFinished = true;
        throw ON_ERROR_FAILURE;
      },
    },
  );

  try {
    const first = heartbeat.refreshNow();
    await waitUntil(() => starts.length === 1);
    const second = heartbeat.refreshNow();
    const third = heartbeat.refreshNow();
    await rm(lockPath, { force: true });

    const firstStop = heartbeat.stop();
    const secondStop = heartbeat.stop();
    assert.equal(firstStop, secondStop);
    assert.equal(await isPromisePending(firstStop), true);

    const ignored = heartbeat.refreshNow();
    assert.equal(ignored, firstStop);
    assert.equal(starts.length, 1);

    gates[0]?.();
    await first;
    assert.equal(await isPromisePending(firstStop), true);

    gates[1]?.();
    await second;
    assert.equal(secondContainmentFinished, true);
    await waitUntil(() => starts.length === 3);
    assert.equal(await isPromisePending(firstStop), true);

    gates[2]?.();
    await third;
    await firstStop;
    await rm(lockPath, { force: true });
    await delay(TEST_HEARTBEAT_INTERVAL_MS * 2 + TEST_HEARTBEAT_POLL_MS);
    assert.equal(await lockFileExists(lockPath), false);
    assert.equal(starts.length, 3);
  } finally {
    for (const release of gates) release();
    await heartbeat.stop();
    await rm(lockDir, { recursive: true, force: true });
  }
});
