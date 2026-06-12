import { homedir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";

export function resolveLockDir(): string {
  return resolve(homedir(), ".pi", "pi-x-ide", "lock");
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
