import { homedir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { LOCK_DIR_ENV } from "./protocol";

export function resolveLockDir(env: NodeJS.ProcessEnv = process.env): string {
  return env[LOCK_DIR_ENV] && env[LOCK_DIR_ENV].trim()
    ? resolve(env[LOCK_DIR_ENV])
    : resolve(homedir(), ".pi", "pi-x-ide");
}

export function normalizePath(input: string): string {
  return resolve(input);
}

export function isPathInsideOrEqual(parent: string, child: string): boolean {
  const normalizedParent = normalizePath(parent);
  const normalizedChild = normalizePath(child);
  if (normalizedParent === normalizedChild) return true;
  const rel = relative(normalizedParent, normalizedChild);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

export function hasDirectWorkspaceMatch(workspaceFolders: readonly string[], cwd: string): boolean {
  return workspaceFolders.some((workspaceFolder) => isPathInsideOrEqual(workspaceFolder, cwd));
}

export function relationshipMatchLength(workspaceFolder: string, cwd: string): number {
  const workspace = normalizePath(workspaceFolder);
  const active = normalizePath(cwd);

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

export function toRelativeDisplayPath(filePath: string, workspaceFolder?: string, cwd?: string): string {
  const base = workspaceFolder ?? cwd;
  if (!base) return filePath;
  const rel = relative(base, filePath);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return filePath;
  return rel.split(sep).join("/");
}
