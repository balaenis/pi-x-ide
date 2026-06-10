import { readdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { LOCK_FILE_EXTENSION, type IdeLockFile, type LockFileCandidate } from "../shared/protocol";
import { relationshipMatchLength, resolveLockDir } from "../shared/paths";
import { parseLockFileContent } from "../shared/schema";

export interface DiscoverOptions {
  cwd: string;
  lockDir?: string;
  now?: number;
  maxAgeMs?: number;
  checkPid?: boolean;
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
): { matchLength: number; workspaceFolder: string } | undefined {
  let best: { matchLength: number; workspaceFolder: string } | undefined;
  for (const workspaceFolder of lock.workspaceFolders) {
    const matchLength = relationshipMatchLength(workspaceFolder, cwd);
    if (matchLength <= 0) continue;
    if (!best || matchLength > best.matchLength) {
      best = { matchLength, workspaceFolder };
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
  const lockDir = options.lockDir ?? resolveLockDir();
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
      await rm(path, { force: true }).catch(() => undefined);
      continue;
    }

    const match = bestWorkspaceMatch(lock, options.cwd);
    const { matchLength, workspaceFolder } = match ?? {
      matchLength: 0,
      workspaceFolder: lock.workspaceFolders[0] ?? "",
    };

    candidates.push({ path, lock, mtimeMs, matchLength, workspaceFolder });
  }

  return sortCandidates(candidates);
}

export async function resolveBestIdeCandidate(options: DiscoverOptions): Promise<LockFileCandidate | undefined> {
  return (await discoverIdeCandidates(options))[0];
}
