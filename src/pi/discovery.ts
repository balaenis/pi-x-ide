// ABOUTME: Discovers IDE lock files and ranks candidates for Pi auto-connect.
// ABOUTME: Scans local and WSL-visible Windows lock directories while cleaning stale files safely.
import { readdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
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

export async function discoverIdeCandidates(options: DiscoverOptions): Promise<LockFileCandidate[]> {
  const env = options.env ?? process.env;
  const lockDirs = resolveLockDirs({
    lockDir: options.lockDir,
    homeLockDir: options.homeLockDir,
    env,
    windowsUsersRoot: options.windowsUsersRoot,
  });
  const candidates: LockFileCandidate[] = [];
  for (const lockDir of lockDirs) {
    candidates.push(...(await discoverIdeCandidatesInDir(lockDir, options, env)));
  }

  return sortCandidates(candidates);
}

async function discoverIdeCandidatesInDir(
  lockDir: string,
  options: DiscoverOptions,
  env: NodeJS.ProcessEnv,
): Promise<LockFileCandidate[]> {
  const now = options.now ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? 24 * 60 * 60 * 1000;
  const checkPid = options.checkPid ?? true;

  let entries: string[];
  try {
    entries = await readdir(lockDir);
  } catch {
    return [];
  }

  const candidates: LockFileCandidate[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(LOCK_FILE_EXTENSION)) continue;
    const path = join(lockDir, entry);
    let content: string;
    let mtimeMs: number;
    try {
      const [fileContent, fileStat] = await Promise.all([readFile(path, "utf8"), stat(path)]);
      content = fileContent;
      mtimeMs = fileStat.mtimeMs;
    } catch {
      continue;
    }

    if (now - mtimeMs > maxAgeMs) {
      await rm(path, { force: true }).catch(() => undefined);
      continue;
    }
    const lock = parseLockFileContent(content);
    if (!lock) {
      await rm(path, { force: true }).catch(() => undefined);
      continue;
    }
    if (checkPid && typeof lock.pid === "number" && !isProcessAlive(lock.pid)) {
      if (lock.runningInWindows === true && isWsl(env)) {
        const reachable = await isDeadWindowsPidLockReachable(lock, options, env);
        if (!reachable) {
          await rm(path, { force: true }).catch(() => undefined);
          continue;
        }
      } else {
        await rm(path, { force: true }).catch(() => undefined);
        continue;
      }
    }

    const match = bestWorkspaceMatch(lock, options.cwd, env);
    const { matchLength, workspaceFolder } = match ?? {
      matchLength: 0,
      workspaceFolder: lock.workspaceFolders[0] ? normalizePathForHost(lock.workspaceFolders[0], env) : "",
    };

    candidates.push({ path, lock, mtimeMs, matchLength, workspaceFolder });
  }

  return candidates;
}

async function isDeadWindowsPidLockReachable(
  lock: IdeLockFile,
  options: DiscoverOptions,
  env: NodeJS.ProcessEnv,
): Promise<boolean> {
  try {
    const host = await (
      options.resolveHost ?? ((ideLock) => resolveIdeHost(ideLock, { env, tcpProbe: options.tcpProbe }))
    )(lock);
    return await (options.tcpProbe ?? tcpReachable)(host, lock.port, IDE_HOST_TCP_PROBE_TIMEOUT_MS);
  } catch {
    return false;
  }
}

export async function resolveBestIdeCandidate(options: DiscoverOptions): Promise<LockFileCandidate | undefined> {
  return (await discoverIdeCandidates(options))[0];
}
