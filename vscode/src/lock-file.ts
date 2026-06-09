import { randomBytes } from "node:crypto";
import { mkdir, rename, rm, writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import * as vscode from "vscode";
import { LOCK_FILE_EXTENSION, type IdeLockFile } from "../../src/shared/protocol";
import { resolveLockDir } from "../../src/shared/paths";

export function createAuthToken(): string {
  return randomBytes(32).toString("hex");
}

export function currentWorkspaceFolders(): string[] {
  return (vscode.workspace.workspaceFolders ?? [])
    .map((folder) => folder.uri.fsPath)
    .filter((path) => path.length > 0);
}

export function createLockFilePath(port: number): string {
  return join(resolveLockDir(), `vscode-${process.pid}-${port}${LOCK_FILE_EXTENSION}`);
}

export async function writeIdeLockFile(path: string, lock: IdeLockFile): Promise<void> {
  const dir = resolveLockDir();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700).catch(() => undefined);

  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(lock, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(tmp, 0o600).catch(() => undefined);
  await rename(tmp, path);
  await chmod(path, 0o600).catch(() => undefined);
}

export async function removeIdeLockFile(path: string | undefined): Promise<void> {
  if (!path) return;
  await rm(path, { force: true }).catch(() => undefined);
}

export function createLockFile(port: number, authToken: string): IdeLockFile {
  const now = new Date().toISOString();
  return {
    version: 1,
    ide: "vscode",
    name: "Visual Studio Code",
    transport: "ws",
    host: "127.0.0.1",
    port,
    authToken,
    workspaceFolders: currentWorkspaceFolders(),
    pid: process.pid,
    createdAt: now,
    updatedAt: now,
  };
}

export function refreshLockFile(lock: IdeLockFile): IdeLockFile {
  return {
    ...lock,
    workspaceFolders: currentWorkspaceFolders(),
    updatedAt: new Date().toISOString(),
  };
}
