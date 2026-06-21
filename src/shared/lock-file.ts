import { randomBytes } from "node:crypto";
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LOCK_FILE_EXTENSION, type IdeLockFile, type IdeSource } from "./protocol";
import { resolveLockDir } from "./paths";

export function createAuthToken(): string {
  return randomBytes(32).toString("hex");
}

export function createIdeLockFilePath(source: IdeSource, port: number, pid = process.pid, lockDir?: string): string {
  return join(lockDir ?? resolveLockDir(), `${source}-${pid}-${port}${LOCK_FILE_EXTENSION}`);
}

export interface CreateIdeLockFileOptions {
  ide: IdeSource;
  name: string;
  port: number;
  authToken: string;
  workspaceFolders: string[];
  pid?: number;
  runningInWindows?: boolean;
  now?: Date;
}

export function createIdeLockFile(options: CreateIdeLockFileOptions): IdeLockFile {
  const now = (options.now ?? new Date()).toISOString();
  return {
    version: 1,
    ide: options.ide,
    name: options.name,
    transport: "ws",
    host: "127.0.0.1",
    port: options.port,
    authToken: options.authToken,
    workspaceFolders: options.workspaceFolders,
    pid: options.pid ?? process.pid,
    runningInWindows: options.runningInWindows ?? process.platform === "win32",
    createdAt: now,
    updatedAt: now,
  };
}

export async function writeIdeLockFile(path: string, lock: IdeLockFile, lockDir?: string): Promise<void> {
  const dir = lockDir ?? resolveLockDir();
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

export function refreshIdeLockFile(lock: IdeLockFile, workspaceFolders: string[], now = new Date()): IdeLockFile {
  return {
    ...lock,
    workspaceFolders,
    updatedAt: now.toISOString(),
  };
}
