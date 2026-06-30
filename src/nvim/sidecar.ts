#!/usr/bin/env node
// ABOUTME: Runs the Neovim sidecar process that bridges Neovim selections to Pi over WebSocket.
// ABOUTME: Maintains lock files and contains sidecar message handling failures.
import { createInterface } from "node:readline";
import { type EditorSelectionSnapshot, type IdeLockFile } from "../shared/protocol.js";
import { formatRangeMention } from "../shared/format.js";
import { IdeWebSocketServer } from "../shared/ide-server.js";
import {
  createAuthToken,
  createIdeLockFile,
  createIdeLockFilePath,
  refreshIdeLockFile,
  removeIdeLockFile,
  writeIdeLockFile,
} from "../shared/lock-file.js";
import {
  parseJsonLine,
  parseNvimSidecarMessage,
  parseSidecarConfig,
  type NvimSidecarMessage,
} from "./sidecar-schema.js";

export interface NvimSidecarOptions {
  workspaceFolders?: string[];
  name?: string;
  lockDir?: string;
  stdin?: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
}

export interface NvimSidecarHandle {
  server: IdeWebSocketServer;
  lockFilePath: string;
  stop: () => Promise<void>;
}

interface RuntimeState {
  latestSelection?: EditorSelectionSnapshot;
  workspaceFolders: string[];
  lockFile?: IdeLockFile;
  lockFilePath?: string;
  stopped: boolean;
}

export async function startNvimSidecar(options: NvimSidecarOptions = {}): Promise<NvimSidecarHandle> {
  const state: RuntimeState = {
    workspaceFolders: normalizeWorkspaceFolders(options.workspaceFolders),
    stopped: false,
  };

  const authToken = createAuthToken();
  const server = new IdeWebSocketServer(
    authToken,
    { name: options.name ?? "Neovim", ide: "nvim" },
    () => state.latestSelection,
  );

  const port = await server.start();
  state.lockFilePath = createIdeLockFilePath("nvim", port, undefined, options.lockDir);
  state.lockFile = createIdeLockFile({
    ide: "nvim",
    name: options.name ?? "Neovim",
    port,
    authToken,
    workspaceFolders: state.workspaceFolders,
  });
  await writeIdeLockFile(state.lockFilePath, state.lockFile);

  const stdout = options.stdout ?? process.stdout;
  stdout.write(JSON.stringify({ type: "ready", port, lockFilePath: state.lockFilePath }) + "\n");

  const stop = async () => {
    if (state.stopped) return;
    state.stopped = true;
    await removeIdeLockFile(state.lockFilePath);
    await server.stop();
  };

  const stdin = options.stdin ?? process.stdin;
  const stderr = options.stderr ?? process.stderr;
  const stopSafely = (reason: string) => {
    void stop().catch((error: unknown) => {
      stderr.write(`pi-x-ide nvim sidecar: failed to stop after ${reason}: ${errorMessage(error)}\n`);
    });
  };
  const rl = createInterface({ input: stdin });
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const parsed = parseJsonLine(trimmed);
    const config = parseSidecarConfig(parsed);
    if (config && !("type" in (parsed as Record<string, unknown>))) {
      void applyConfig(state, config, stderr).catch((error: unknown) => {
        stderr.write(`pi-x-ide nvim sidecar: failed to apply config: ${errorMessage(error)}\n`);
      });
      return;
    }

    const message = parseNvimSidecarMessage(parsed);
    if (!message) {
      stderr.write(`pi-x-ide nvim sidecar: ignored malformed message: ${trimmed}\n`);
      return;
    }
    void handleMessage(state, server, message, stderr, stop).catch((error: unknown) => {
      stderr.write(`pi-x-ide nvim sidecar: failed to handle message: ${errorMessage(error)}\n`);
    });
  });
  rl.on("close", () => stopSafely("stdin close"));

  const cleanup = () => stopSafely("process signal");
  process.once("SIGINT", cleanup);
  process.once("SIGTERM", cleanup);
  process.once("beforeExit", cleanup);

  return { server, lockFilePath: state.lockFilePath, stop };
}

async function applyConfig(
  state: RuntimeState,
  config: { workspaceFolders?: string[] },
  stderr: NodeJS.WritableStream,
) {
  if (config.workspaceFolders) state.workspaceFolders = normalizeWorkspaceFolders(config.workspaceFolders);
  if (!state.lockFilePath || !state.lockFile) return;
  state.lockFile = refreshIdeLockFile(state.lockFile, state.workspaceFolders);
  try {
    await writeIdeLockFile(state.lockFilePath, state.lockFile);
  } catch (error) {
    stderr.write(`pi-x-ide nvim sidecar: failed to refresh lock file: ${errorMessage(error)}\n`);
  }
}

async function handleMessage(
  state: RuntimeState,
  server: IdeWebSocketServer,
  message: NvimSidecarMessage,
  stderr: NodeJS.WritableStream,
  stop: () => Promise<void>,
): Promise<void> {
  switch (message.type) {
    case "selection_changed": {
      const snapshot = withNvimSource(message.snapshot);
      state.latestSelection = snapshot;
      server.broadcast({
        jsonrpc: "2.0",
        method: "selection_changed",
        params: { ...snapshot, receivedAt: snapshot.receivedAt ?? Date.now() },
      });
      return;
    }
    case "selection_cleared":
      state.latestSelection = undefined;
      server.broadcast({
        jsonrpc: "2.0",
        method: "selection_cleared",
        params: { source: "nvim", reason: message.reason ?? "no-active-editor", receivedAt: Date.now() },
      });
      return;
    case "at_mentioned": {
      const snapshot = withNvimSource(message.snapshot);
      state.latestSelection = snapshot;
      const rangeText = message.rangeText || formatRangeMention(snapshot);
      server.broadcast({
        jsonrpc: "2.0",
        method: "at_mentioned",
        params: { ...snapshot, rangeText, receivedAt: snapshot.receivedAt ?? Date.now() },
      });
      return;
    }
    case "workspace_changed":
      await applyConfig(state, { workspaceFolders: message.workspaceFolders }, stderr);
      return;
    case "shutdown":
      await stop();
      return;
  }
}

function withNvimSource<T extends EditorSelectionSnapshot>(snapshot: T): T {
  return { ...snapshot, source: "nvim" };
}

function normalizeWorkspaceFolders(workspaceFolders: string[] | undefined): string[] {
  const folders = workspaceFolders?.filter((folder) => folder.length > 0) ?? [];
  return folders.length > 0 ? folders : [process.cwd()];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseCliArgs(argv: string[]): NvimSidecarOptions | "help" {
  const options: NvimSidecarOptions = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") return "help";
    if (arg === "--name") options.name = argv[++index];
    else if (arg === "--lock-dir") options.lockDir = argv[++index];
    else if (arg === "--workspace-folder") {
      options.workspaceFolders = [...(options.workspaceFolders ?? []), argv[++index]].filter(Boolean);
    } else if (arg === "--workspace-folders") {
      const value = argv[++index];
      const parsed = parseJsonLine(value ?? "");
      const config = parseSidecarConfig({ workspaceFolders: parsed });
      if (config?.workspaceFolders) options.workspaceFolders = config.workspaceFolders;
    }
  }
  return options;
}

function printHelp(): void {
  process.stdout.write(
    `Usage: pi-x-ide-nvim-sidecar [options]\n\nOptions:\n  --workspace-folder <path>   Add a workspace folder. May be repeated.\n  --workspace-folders <json>  JSON array of workspace folders.\n  --lock-dir <path>           Override PI_X_IDE_LOCK_DIR for tests.\n  --name <name>               Display name reported to Pi.\n  --help                      Show this help.\n`,
  );
}

export function runNvimSidecarCli(argv = process.argv.slice(2)): void {
  const parsed = parseCliArgs(argv);
  if (parsed === "help") {
    printHelp();
    return;
  }

  startNvimSidecar(parsed).catch((error: unknown) => {
    process.stderr.write(`pi-x-ide nvim sidecar: ${errorMessage(error)}\n`);
    process.exitCode = 1;
  });
}
