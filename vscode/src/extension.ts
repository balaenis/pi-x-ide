import * as vscode from "vscode";
import { PROTOCOL_VERSION } from "../../src/shared/protocol";
import { formatRangeMention } from "../../src/shared/format";
import {
  createAuthToken,
  createLockFile,
  createLockFilePath,
  refreshLockFile,
  removeIdeLockFile,
  writeIdeLockFile,
} from "./lock-file";
import { IdeWebSocketServer } from "./server";
import { getActiveSelectionSnapshot, getConfiguredRangeFormat } from "./selection";

let server: IdeWebSocketServer | undefined;
let lockFilePath: string | undefined;
let lockFile = undefined as ReturnType<typeof createLockFile> | undefined;
let debounceTimer: NodeJS.Timeout | undefined;
let status: vscode.StatusBarItem | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const packageJson = context.extension.packageJSON as { version?: string };
  const authToken = createAuthToken();

  server = new IdeWebSocketServer(
    authToken,
    {
      name: "Pi x IDE VS Code",
      version: packageJson.version,
    },
    getActiveSelectionSnapshot,
  );

  const port = await server.start();
  lockFilePath = createLockFilePath(port);
  lockFile = createLockFile(port, authToken);
  await writeIdeLockFile(lockFilePath, lockFile);

  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.name = "Pi x IDE";
  status.command = "pi-x-ide.attachSelection";
  context.subscriptions.push(status);
  updateStatus("ready");

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => scheduleSelectionBroadcast()),
    vscode.window.onDidChangeTextEditorSelection(() => scheduleSelectionBroadcast()),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      refreshLock().catch(handleRefreshLockError);
      scheduleSelectionBroadcast();
    }),
    vscode.commands.registerCommand("pi-x-ide.attachSelection", () => attachSelection()),
    { dispose: () => void cleanup() },
  );

  scheduleSelectionBroadcast(0);
}

export async function deactivate(): Promise<void> {
  await cleanup();
}

async function cleanup(): Promise<void> {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = undefined;
  await removeIdeLockFile(lockFilePath);
  lockFilePath = undefined;
  await server?.stop();
  server = undefined;
  status?.dispose();
  status = undefined;
}

async function refreshLock(): Promise<void> {
  if (!lockFilePath || !lockFile) return;
  lockFile = refreshLockFile(lockFile);
  await writeIdeLockFile(lockFilePath, lockFile);
}

function handleRefreshLockError(error: unknown): void {
  const suffix = error instanceof Error ? `: ${error.message}` : "";
  void vscode.window.showWarningMessage(`Pi x IDE: failed to refresh lock file${suffix}`);
}

function scheduleSelectionBroadcast(delayMs = 150): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = undefined;
    broadcastSelection();
  }, delayMs);
}

function broadcastSelection(): void {
  const snapshot = getActiveSelectionSnapshot();
  if (!server) {
    updateStatus("no-file");
    return;
  }

  if (!snapshot) {
    server.broadcast({
      jsonrpc: "2.0",
      method: "selection_cleared",
      params: {
        source: "vscode",
        reason: "no-active-editor",
        receivedAt: Date.now(),
      },
    });
    updateStatus("no-file");
    return;
  }

  server.broadcast({
    jsonrpc: "2.0",
    method: "selection_changed",
    params: {
      ...snapshot,
      receivedAt: Date.now(),
    },
  });
  updateStatus(snapshot.ranges.length > 0 ? "selection" : "file");
}

function attachSelection(): void {
  const snapshot = getActiveSelectionSnapshot();
  if (!snapshot || !server) {
    vscode.window.showWarningMessage("Pi x IDE: no active file to attach.");
    return;
  }

  const rangeText = formatRangeMention(snapshot, { format: getConfiguredRangeFormat() });
  server.broadcast({
    jsonrpc: "2.0",
    method: "at_mentioned",
    params: {
      ...snapshot,
      rangeText,
      receivedAt: Date.now(),
    },
  });

  if (server.clientCount === 0) {
    vscode.window.showWarningMessage(`Pi x IDE: no Pi clients connected. Reference: ${rangeText}`);
  } else {
    vscode.window.setStatusBarMessage(`Pi x IDE attached ${rangeText}`, 2500);
  }
}

function updateStatus(state: "ready" | "file" | "selection" | "no-file"): void {
  if (!status || !server) return;
  const suffix = server.clientCount > 0 ? `${server.clientCount} Pi` : "waiting";
  const icon = state === "selection" ? "$(symbol-string)" : state === "file" ? "$(file-code)" : "$(plug)";
  status.text = `${icon} Pi x IDE ${suffix}`;
  status.tooltip = `Pi x IDE WebSocket server on protocol v${PROTOCOL_VERSION}. Click to attach the active selection.`;
  status.show();
}
