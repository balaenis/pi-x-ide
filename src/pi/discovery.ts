// ABOUTME: Discovers IDE lock files and ranks candidates for Pi auto-connect.
// ABOUTME: Scans local and WSL-visible Windows lock directories while cleaning stale files safely.
import { readdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import { LOCK_FILE_EXTENSION, type IdeLockFile, type LockFileCandidate } from "../shared/protocol.js";
import { relationshipMatchLength, resolveLockDirs } from "../shared/paths.js";
import { parseLockFileContent } from "../shared/schema.js";
import { isWsl, normalizePathForHost } from "../shared/platform.js";
import { IDE_HOST_TCP_PROBE_TIMEOUT_MS, resolveIdeHost, tcpReachable } from "./ide-host.js";

export interface DiscoverOptions {
  cwd: string;
  lockDir?: string;
  homeLockDir?: string;
  now?: number;
  maxAgeMs?: number;
  checkPid?: boolean;
  env?: NodeJS.ProcessEnv;
  windowsUsersRoot?: string;
  resolveHost?: (lock: IdeLockFile) => Promise<string>;
  tcpProbe?: (host: string, port: number, timeoutMs: number) => Promise<boolean>;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isUsableLocalPid(pid: number | undefined): pid is number {
  return typeof pid === "number" && Number.isSafeInteger(pid) && pid > 0;
}

function bestWorkspaceMatch(
  lock: IdeLockFile,
  cwd: string,
  env: NodeJS.ProcessEnv,
): { matchLength: number; workspaceFolder: string } | undefined {
  let best: { matchLength: number; workspaceFolder: string } | undefined;
  for (const workspaceFolder of lock.workspaceFolders) {
    const matchLength = relationshipMatchLength(workspaceFolder, cwd, env);
    if (matchLength <= 0) continue;
    if (!best || matchLength > best.matchLength) {
      best = { matchLength, workspaceFolder: normalizePathForHost(workspaceFolder, env) };
    }
  }
  return best;
}

export function sortCandidates(candidates: LockFileCandidate[]): LockFileCandidate[] {
  return [...candidates].sort(
    (a, b) => b.matchLength - a.matchLength || b.mtimeMs - a.mtimeMs || a.path.localeCompare(b.path),
  );
}

function removeLockFile(path: string): Effect.Effect<void, never, never> {
  return Effect.promise(() =>
    rm(path, { force: true }).then(
      () => undefined,
      () => undefined,
    ),
  );
}

function isWindowsLockReachable(
  lock: IdeLockFile,
  options: DiscoverOptions,
  env: NodeJS.ProcessEnv,
): Effect.Effect<boolean, never, never> {
  return Effect.promise(async () => {
    try {
      const host = await (
        options.resolveHost ?? ((ideLock) => resolveIdeHost(ideLock, { env, tcpProbe: options.tcpProbe }))
      )(lock);
      return await (options.tcpProbe ?? tcpReachable)(host, lock.port, IDE_HOST_TCP_PROBE_TIMEOUT_MS);
    } catch {
      return false;
    }
  });
}

function discoverIdeCandidatesInDirEffect(
  lockDir: string,
  options: DiscoverOptions,
  env: NodeJS.ProcessEnv,
): Effect.Effect<LockFileCandidate[], never, never> {
  return Effect.gen(function* () {
    const now = options.now ?? Date.now();
    const maxAgeMs = options.maxAgeMs ?? 24 * 60 * 60 * 1000;
    const checkPid = options.checkPid ?? true;

    const entries = yield* Effect.promise(async () => {
      try {
        return await readdir(lockDir);
      } catch {
        return [] as string[];
      }
    });

    const candidates: LockFileCandidate[] = [];
    for (const entry of entries) {
      if (!entry.endsWith(LOCK_FILE_EXTENSION)) continue;
      const path = join(lockDir, entry);

      const file = yield* Effect.promise(async () => {
        try {
          const [content, fileStat] = await Promise.all([readFile(path, "utf8"), stat(path)]);
          return { content, mtimeMs: fileStat.mtimeMs } as const;
        } catch {
          return undefined;
        }
      });
      if (!file) continue;

      const lock = parseLockFileContent(file.content);
      if (!lock) {
        yield* removeLockFile(path);
        continue;
      }

      const isWindowsSideWsl = lock.runningInWindows === true && isWsl(env);
      const pid = lock.pid;

      if (checkPid && isWindowsSideWsl) {
        const reachable = yield* isWindowsLockReachable(lock, options, env);
        if (!reachable) {
          yield* removeLockFile(path);
          continue;
        }
      } else if (checkPid && isUsableLocalPid(pid)) {
        if (!isProcessAlive(pid)) {
          yield* removeLockFile(path);
          continue;
        }
      } else if (now - file.mtimeMs > maxAgeMs) {
        yield* removeLockFile(path);
        continue;
      }

      const match = bestWorkspaceMatch(lock, options.cwd, env);
      const { matchLength, workspaceFolder } = match ?? {
        matchLength: 0,
        workspaceFolder: lock.workspaceFolders[0] ? normalizePathForHost(lock.workspaceFolders[0], env) : "",
      };

      candidates.push({ path, lock, mtimeMs: file.mtimeMs, matchLength, workspaceFolder });
    }

    return candidates;
  });
}

export function discoverIdeCandidatesEffect(
  options: DiscoverOptions,
): Effect.Effect<LockFileCandidate[], never, never> {
  return Effect.gen(function* () {
    const env = options.env ?? process.env;
    const lockDirs = resolveLockDirs({
      lockDir: options.lockDir,
      homeLockDir: options.homeLockDir,
      env,
      windowsUsersRoot: options.windowsUsersRoot,
    });

    const candidates: LockFileCandidate[] = [];
    for (const lockDir of lockDirs) {
      const dirCandidates = yield* discoverIdeCandidatesInDirEffect(lockDir, options, env);
      candidates.push(...dirCandidates);
    }

    return sortCandidates(candidates);
  });
}

export async function discoverIdeCandidates(options: DiscoverOptions): Promise<LockFileCandidate[]> {
  return Effect.runPromise(discoverIdeCandidatesEffect(options));
}

export async function resolveBestIdeCandidate(options: DiscoverOptions): Promise<LockFileCandidate | undefined> {
  return (await discoverIdeCandidates(options))[0];
}
