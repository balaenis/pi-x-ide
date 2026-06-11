import * as vscode from "vscode";
import type { IdeLockFile } from "../../src/shared/protocol";
import {
  createAuthToken,
  createIdeLockFile,
  createIdeLockFilePath,
  refreshIdeLockFile,
  removeIdeLockFile,
  writeIdeLockFile,
} from "../../src/shared/lock-file";

export { createAuthToken, removeIdeLockFile, writeIdeLockFile };

export function currentWorkspaceFolders(): string[] {
  return (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath).filter((path) => path.length > 0);
}

export function createLockFilePath(port: number): string {
  return createIdeLockFilePath("vscode", port);
}

export function createLockFile(port: number, authToken: string): IdeLockFile {
  return createIdeLockFile({
    ide: "vscode",
    name: "Visual Studio Code",
    port,
    authToken,
    workspaceFolders: currentWorkspaceFolders(),
  });
}

export function refreshLockFile(lock: IdeLockFile): IdeLockFile {
  return refreshIdeLockFile(lock, currentWorkspaceFolders());
}
