// ABOUTME: Resolves and compares filesystem paths for IDE discovery and display.
// ABOUTME: Applies host-aware normalization so WSL, Windows, and Linux paths can match safely.
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { normalizePathForHost, windowsUserProfileDirs } from "./platform";

export function resolveLockDir(): string {
  return resolve(homedir(), ".pi", "pi-x-ide", "lock");
}

export interface ResolveLockDirsOptions {
  lockDir?: string;
  homeLockDir?: string;
  env?: NodeJS.ProcessEnv;
  windowsUsersRoot?: string;
}

export function resolveLockDirs(options: ResolveLockDirsOptions = {}): string[] {
  if (options.lockDir) return [resolve(options.lockDir)];

  const dirs = [resolve(options.homeLockDir ?? resolveLockDir())];
  for (const profileDir of windowsUserProfileDirs(options.windowsUsersRoot, options.env)) {
    dirs.push(resolve(profileDir, ".pi", "pi-x-ide", "lock"));
  }
  return dedupePaths(dirs);
}

function dedupePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const path of paths) {
    const resolved = resolve(path);
    let key = resolved;
    try {
      key = realpathSync(resolved);
    } catch {
      // The lock directory may not exist yet; resolved path is good enough.
    }
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(resolved);
  }
  return deduped;
}

export function normalizePath(input: string): string {
  const resolved = resolve(input);
  // Normalize drive letter to uppercase on Windows so that path comparison
  // is case-insensitive (VS Code may write workspace paths with lowercase
  // drive letters while process.cwd() uses uppercase).
  if (process.platform === "win32" && resolved.length >= 2 && resolved[1] === ":") {
    return resolved[0].toUpperCase() + resolved.slice(1);
  }
  return resolved;
}

// Host-aware variant: under WSL, fold Windows/UNC paths into the Pi-visible
// Linux path before resolving so cross-boundary comparisons line up. Outside
// WSL this is identical to normalizePath().
export function normalizePathForComparison(input: string, env: NodeJS.ProcessEnv = process.env): string {
  return normalizePath(normalizePathForHost(input, env));
}

export function isPathInsideOrEqual(parent: string, child: string): boolean {
  const normalizedParent = normalizePath(parent);
  const normalizedChild = normalizePath(child);
  if (normalizedParent === normalizedChild) return true;
  const rel = relative(normalizedParent, normalizedChild);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

export function hasDirectWorkspaceMatch(
  workspaceFolders: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const normalizedCwd = normalizePathForComparison(cwd, env);
  return workspaceFolders.some((workspaceFolder) =>
    isPathInsideOrEqual(normalizePathForComparison(workspaceFolder, env), normalizedCwd),
  );
}

export function relationshipMatchLength(
  workspaceFolder: string,
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const workspace = normalizePathForComparison(workspaceFolder, env);
  const active = normalizePathForComparison(cwd, env);

  // Best case: Pi is started inside the IDE workspace.
  if (isPathInsideOrEqual(workspace, active)) {
    return workspace.length + 10_000;
  }

  // Accept the inverse relationship for monorepos where Pi starts above a nested workspace,
  // but rank it lower than a workspace containing cwd.
  if (isPathInsideOrEqual(active, workspace)) {
    return active.length;
  }

  return 0;
}

export function toRelativeDisplayPath(
  filePath: string,
  workspaceFolder?: string,
  cwd?: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const base = workspaceFolder ?? cwd;
  if (!base) return normalizePathForHost(filePath, env);
  const normalizedFilePath = normalizePathForHost(filePath, env);
  const normalizedBase = normalizePathForHost(base, env);
  const rel = relative(normalizedBase, normalizedFilePath);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return normalizedFilePath;
  return rel.split(sep).join("/");
}
