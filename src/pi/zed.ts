// ABOUTME: Provides Zed editor integration by polling Zed's local SQLite state.
// ABOUTME: Normalizes Zed paths and selections while containing polling failures.
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent" with {
  "resolution-mode": "import",
};
import type { EditorSelectionSnapshot, SelectionRange } from "../shared/protocol.js";
import { resolvePiConfigEnv } from "../shared/config.js";
import { isWsl, normalizePathForHost } from "../shared/platform.js";
import { snapshotKey } from "../shared/format.js";
import { isPathInsideOrEqual } from "../shared/paths.js";
import { clearLatestSelection, setLatestSelection } from "./selection.js";
import type { PiIdeRuntime } from "./state.js";
import { containPiError } from "./safety.js";
import { updateIdeUi } from "./ui.js";

export { isWsl };

export const PI_X_IDE_ZED_DB_ENV = "PI_X_IDE_ZED_DB";
export const PI_X_IDE_ZED_POLL_INTERVAL_MS_ENV = "PI_X_IDE_ZED_POLL_INTERVAL_MS";
export const ZED_POLL_INTERVAL_MS = 1000;
export const ZED_POLL_INTERVAL_MS_MIN = 100;
export const ZED_POLL_INTERVAL_MS_MAX = 2000;

// ── Terminal detection ──────────────────────────────────────────

export function isZedTerminal(env: NodeJS.ProcessEnv = process.env): boolean {
  const configuredEnv = resolvePiConfigEnv(env);
  return configuredEnv.ZED_TERM === "true" || configuredEnv.TERM_PROGRAM?.toLowerCase() === "zed";
}

// Backward-compatible wrapper: Zed callers and tests import this name, while the
// implementation now lives in the shared platform helper.
export function normalizeZedPathForHost(input: string, env: NodeJS.ProcessEnv = process.env): string {
  return normalizePathForHost(input, env);
}

// ── DB path resolution ─────────────────────────────────────────

export function resolveZedDbPath(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string | undefined {
  const configuredEnv = resolvePiConfigEnv(env);
  const override = configuredEnv[PI_X_IDE_ZED_DB_ENV]?.trim();
  if (override) {
    const normalizedOverride = normalizeZedPathForHost(override, configuredEnv);
    return isFile(normalizedOverride) ? normalizedOverride : undefined;
  }

  const candidates = [
    resolve(home, ".local", "share", "zed", "db", "0-stable", "db.sqlite"), // Linux
    resolve(home, "Library", "Application Support", "Zed", "db", "0-stable", "db.sqlite"), // macOS
    resolve(home, "AppData", "Local", "Zed", "db", "0-stable", "db.sqlite"), // Windows
    ...zedDbCandidatesFromWindowsEnv(configuredEnv),
    ...zedDbCandidatesFromWslMount(configuredEnv),
  ];

  return candidates.find(isFile);
}

function zedDbCandidatesFromWindowsEnv(env: NodeJS.ProcessEnv): string[] {
  const localAppData = env.LOCALAPPDATA?.trim();
  if (localAppData) return [resolve(normalizeZedPathForHost(localAppData, env), "Zed", "db", "0-stable", "db.sqlite")];

  const userProfile = env.USERPROFILE?.trim();
  if (userProfile) {
    return [
      resolve(normalizeZedPathForHost(userProfile, env), "AppData", "Local", "Zed", "db", "0-stable", "db.sqlite"),
    ];
  }

  return [];
}

function zedDbCandidatesFromWslMount(env: NodeJS.ProcessEnv): string[] {
  if (!isWsl(env)) return [];
  const usersRoot = "/mnt/c/Users";
  try {
    return readdirSync(usersRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => resolve(usersRoot, entry.name, "AppData", "Local", "Zed", "db", "0-stable", "db.sqlite"));
  } catch {
    return [];
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

interface ZedDatabaseHandle {
  db: DatabaseSync;
  cleanup: () => void;
}

function openZedDatabase(dbPath: string, env: NodeJS.ProcessEnv = process.env): ZedDatabaseHandle | undefined {
  const configuredEnv = resolvePiConfigEnv(env);
  // Direct open on live WAL-mode databases can succeed at construction time
  // but fail on the first query on WSL/Windows mounts. Always snapshot
  // under WSL to avoid "disk I/O error" during SQL execution.
  if (isWsl(configuredEnv)) return openZedDatabaseSnapshot(dbPath);

  try {
    return { db: new DatabaseSync(dbPath, { readOnly: true }), cleanup: () => undefined };
  } catch {
    // Fall back to snapshot if direct open throws (e.g. file lock on non-WSL).
    return openZedDatabaseSnapshot(dbPath);
  }
}

function openZedDatabaseSnapshot(dbPath: string): ZedDatabaseHandle | undefined {
  let snapshotDir: string | undefined;

  try {
    snapshotDir = mkdtempSync(join(tmpdir(), "pi-x-ide-zed-db-"));
    const cleanupDir = snapshotDir;
    const snapshotPath = join(cleanupDir, "db.sqlite");

    // Copy the main DB file plus any WAL/SHM sidecars.
    copyFileSync(dbPath, snapshotPath);
    for (const suffix of ["-wal", "-shm"]) {
      const sidecarPath = `${dbPath}${suffix}`;
      if (isFile(sidecarPath)) copyFileSync(sidecarPath, `${snapshotPath}${suffix}`);
    }

    // Merge WAL changes into the main database file so we can open
    // read-only afterwards without hitting a disk I/O error on
    // cross-filesystem mounts (WSL / Windows).
    try {
      const dbRW = new DatabaseSync(snapshotPath);
      dbRW.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      dbRW.close();
    } catch {
      // Checkpoint may fail—continue with the stale main DB.
    }

    return {
      db: new DatabaseSync(snapshotPath, { readOnly: true }),
      cleanup: () => rmSync(cleanupDir, { recursive: true, force: true }),
    };
  } catch {
    if (snapshotDir) rmSync(snapshotDir, { recursive: true, force: true });
    return undefined;
  }
}

// ── Workspace path parsing ─────────────────────────────────────

export function parseZedWorkspacePaths(value: string | null): string[] {
  if (!value) return [];
  const trimmed = value.trim();
  if (!trimmed) return [];

  // Try JSON array. If it looks like JSON but is malformed, treat it as invalid
  // instead of accidentally interpreting the raw JSON-ish text as a path.
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === "string" && item.length > 0)
        : [];
    } catch {
      return [];
    }
  }

  return trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

// ── UTF-8 byte-offset conversion ──────────────────────────────

function utf8ByteOffsetToStringIndex(text: string, byteOffset: number): number {
  if (byteOffset <= 0) return 0;

  const encoder = new TextEncoder();
  let bytes = 0;

  for (let index = 0; index < text.length; ) {
    const codePoint = text.codePointAt(index);
    if (codePoint === undefined) return text.length;

    const nextIndex = index + (codePoint > 0xffff ? 2 : 1);
    bytes += encoder.encode(text.slice(index, nextIndex)).length;
    if (bytes >= byteOffset) return nextIndex;
    index = nextIndex;
  }

  return text.length;
}

function byteOffsetToSelection(
  text: string,
  startByte: number,
  endByte: number,
): { start: { line: number; character: number }; end: { line: number; character: number } } {
  const startIndex = utf8ByteOffsetToStringIndex(text, startByte);
  const endIndex = utf8ByteOffsetToStringIndex(text, endByte);

  const lines = text.split("\n");
  let startLine = 0;
  let startChar = 0;
  let remaining = startIndex;
  for (let lineIdx = 0; lineIdx < lines.length && remaining >= 0; lineIdx += 1) {
    const lineLen = lines[lineIdx].length + 1; // +1 for the \n
    if (remaining <= lines[lineIdx].length) {
      startLine = lineIdx;
      startChar = remaining;
      break;
    }
    remaining -= lineLen;
  }

  let endLine = 0;
  let endChar = 0;
  remaining = endIndex;
  for (let lineIdx = 0; lineIdx < lines.length && remaining >= 0; lineIdx += 1) {
    const lineLen = lines[lineIdx].length + 1;
    if (remaining <= lines[lineIdx].length) {
      endLine = lineIdx;
      endChar = remaining;
      break;
    }
    remaining -= lineLen;
  }

  return {
    start: { line: startLine, character: startChar },
    end: { line: endLine, character: endChar },
  };
}

// ── SQLite query ───────────────────────────────────────────────

function scoreWorkspace(workspacePaths: string | null, cwd: string, env: NodeJS.ProcessEnv): number {
  const normalizedCwd = normalizeZedPathForHost(cwd, env);
  return parseZedWorkspacePaths(workspacePaths).reduce((best, workspacePath) => {
    const normalizedWorkspacePath = normalizeZedPathForHost(workspacePath, env);
    if (isPathInsideOrEqual(normalizedWorkspacePath, normalizedCwd)) {
      const resolved = resolve(normalizedWorkspacePath);
      return Math.max(best, resolved.length);
    }
    return best;
  }, 0);
}

export interface ResolveZedSelectionOptions {
  dbPath: string;
  cwd: string;
  now?: number;
  readFile?: (path: string) => string;
  env?: NodeJS.ProcessEnv;
}

export function resolveZedSelection(options: ResolveZedSelectionOptions): EditorSelectionSnapshot | undefined {
  const { dbPath, cwd, readFile = (path) => readFileSync(path, "utf8"), env: inputEnv = process.env } = options;
  const env = resolvePiConfigEnv(inputEnv);
  const dbHandle = openZedDatabase(dbPath, env);
  if (!dbHandle) return undefined;

  const { db, cleanup } = dbHandle;

  try {
    const rows = db
      .prepare(
        `SELECT i.kind AS item_kind,
                e.item_id AS editor_id,
                i.workspace_id,
                w.paths AS workspace_paths,
                w.timestamp,
                e.buffer_path
         FROM items i
         JOIN panes p ON p.pane_id = i.pane_id AND p.workspace_id = i.workspace_id
         JOIN workspaces w ON w.workspace_id = i.workspace_id
         LEFT JOIN editors e ON e.item_id = i.item_id AND e.workspace_id = i.workspace_id
         WHERE i.active = 1 AND p.active = 1
         ORDER BY w.timestamp DESC`,
      )
      .all() as Array<{
      item_kind: string;
      editor_id: string | null;
      workspace_id: string;
      workspace_paths: string | null;
      timestamp: number;
      buffer_path: string | null;
    }>;

    // Filter to Editor rows only, score by workspace match.
    // editor_id may be string or number — Zed uses INTEGER primary keys,
    // node:sqlite returns them as JS numbers.
    const scored = rows
      .filter(
        (row): row is typeof row & { editor_id: string | number; buffer_path: string } =>
          row.item_kind === "Editor" && row.editor_id != null && typeof row.buffer_path === "string",
      )
      .map((row) => ({
        ...row,
        score: scoreWorkspace(row.workspace_paths, cwd, env),
      }))
      .filter((row) => row.score > 0);

    if (scored.length === 0) return undefined;

    // Pick best: highest score, then latest timestamp
    scored.sort((a, b) => b.score - a.score || b.timestamp - a.timestamp);
    const best = scored[0];
    if (!best) return undefined;

    const { editor_id, workspace_id, buffer_path, workspace_paths } = best;
    const normalizedBufferPath = normalizeZedPathForHost(buffer_path, env);

    // Determine workspace folder from matching path
    const workspaceFolder = bestWorkspaceFolder(workspace_paths, cwd, env);

    // Query editor contents
    let contents: string | undefined;
    const contentRow = db
      .prepare("SELECT contents FROM editors WHERE item_id = ? AND workspace_id = ?")
      .get(editor_id, workspace_id) as { contents: string | null | undefined } | undefined;

    if (contentRow && typeof contentRow.contents === "string") {
      contents = contentRow.contents;
    } else {
      // Fall back to reading the file on disk.
      try {
        contents = readFile(normalizedBufferPath);
      } catch {
        return undefined;
      }
    }

    if (contents === undefined) return undefined;

    // Query selections
    const selectionRows = db
      .prepare(
        "SELECT start AS selection_start, end AS selection_end FROM editor_selections WHERE editor_id = ? AND workspace_id = ?",
      )
      .all(editor_id, workspace_id) as Array<{ selection_start: number; selection_end: number }>;

    const ranges: SelectionRange[] = [];
    for (const sel of selectionRows) {
      const rawStart = sel.selection_start;
      const rawEnd = sel.selection_end;

      // Normalize reversed ranges
      const start = Math.min(rawStart, rawEnd);
      const end = Math.max(rawStart, rawEnd);

      // Skip empty caret positions
      if (start >= end) continue;

      const text = contents.slice(
        utf8ByteOffsetToStringIndex(contents, start),
        utf8ByteOffsetToStringIndex(contents, end),
      );

      if (!text) continue;

      const selection = byteOffsetToSelection(contents, start, end);

      ranges.push({ text, selection });
    }

    return {
      source: "zed",
      filePath: normalizedBufferPath,
      workspaceFolder,
      ranges,
      receivedAt: options.now ?? Date.now(),
    };
  } catch {
    return undefined;
  } finally {
    try {
      db.close();
    } finally {
      cleanup();
    }
  }
}

function bestWorkspaceFolder(workspacePaths: string | null, cwd: string, env: NodeJS.ProcessEnv): string | undefined {
  const paths = parseZedWorkspacePaths(workspacePaths).map((workspacePath) =>
    normalizeZedPathForHost(workspacePath, env),
  );
  const normalizedCwd = normalizeZedPathForHost(cwd, env);
  const matches = paths.filter((workspacePath) => isPathInsideOrEqual(workspacePath, normalizedCwd));
  if (matches.length === 0) return paths[0];
  return matches.sort((a, b) => resolve(b).length - resolve(a).length)[0];
}

// ── Polling lifecycle ─────────────────────────────────────────

export function resolveZedPollIntervalMs(env: NodeJS.ProcessEnv = process.env, intervalMs?: number): number {
  const configuredEnv = resolvePiConfigEnv(env);
  const configuredIntervalRaw = configuredEnv[PI_X_IDE_ZED_POLL_INTERVAL_MS_ENV];
  let configuredInterval: number | undefined;
  if (configuredIntervalRaw !== undefined) {
    const parsed = Number(configuredIntervalRaw);
    if (Number.isFinite(parsed) && parsed > 0) configuredInterval = parsed;
  }
  const resolved = intervalMs ?? configuredInterval ?? ZED_POLL_INTERVAL_MS;
  return Math.min(Math.max(resolved, ZED_POLL_INTERVAL_MS_MIN), ZED_POLL_INTERVAL_MS_MAX);
}

export function stopZedPolling(runtime: PiIdeRuntime): void {
  const fiber = runtime.zedPollFiber;
  runtime.zedPollFiber = undefined;
  runtime.zedPollIntervalMs = undefined;
  if (fiber) {
    // Interrupt is async; clear handle first so stop is idempotent and prompt.
    Effect.runFork(Fiber.interrupt(fiber));
  }
  runtime.zedPollSelectionKey = undefined;
  runtime.zedPollWalMtimeMs = undefined;
}

export function startZedPolling(
  runtime: PiIdeRuntime,
  ctx: Pick<ExtensionContext, "cwd" | "hasUI" | "ui">,
  options?: {
    dbPath?: string;
    intervalMs?: number;
    generation?: number;
    env?: NodeJS.ProcessEnv;
  },
): boolean {
  const env = resolvePiConfigEnv(options?.env ?? process.env);
  if (!isZedTerminal(env)) return false;

  const dbPath = options?.dbPath ?? resolveZedDbPath(env);
  if (!dbPath) return false;

  const intervalMs = resolveZedPollIntervalMs(env, options?.intervalMs);
  const generation = options?.generation;

  // Restart cleanly if a previous fiber is still tracked.
  stopZedPolling(runtime);

  // Set connection status and clear any stale WebSocket candidate state.
  runtime.connection?.disconnect();
  runtime.connection = undefined;
  runtime.currentCandidate = undefined;
  runtime.connectionStatus = "connected";
  runtime.connectedServer = { name: "Zed", ide: "zed" };
  runtime.connectionMessage = undefined;
  runtime.zedPollIntervalMs = intervalMs;
  updateIdeUi(runtime, ctx as ExtensionContext);

  const pollTick = (): "continue" | "stop" => {
    // Guard: session generation changed
    if (generation !== undefined && runtime.sessionGeneration !== generation) return "stop";
    // Guard: WebSocket has taken over
    if (runtime.connection && runtime.connectedServer?.ide !== "zed") return "stop";

    // Check whether the WAL sidecar has changed since the last poll.
    // On WSL the DB snapshot is expensive (~10 MB copy + checkpoint),
    // so skip the work when nothing changed in the editor.
    const walPath = `${dbPath}-wal`;
    let walMtimeMs: number | undefined;
    try {
      walMtimeMs = statSync(walPath).mtimeMs;
    } catch {
      // WAL absent — always poll (Zed may be in a different journal mode).
    }
    if (
      walMtimeMs !== undefined &&
      runtime.zedPollWalMtimeMs !== undefined &&
      walMtimeMs === runtime.zedPollWalMtimeMs
    ) {
      return "continue";
    }
    runtime.zedPollWalMtimeMs = walMtimeMs;

    let snapshot: EditorSelectionSnapshot | undefined;
    try {
      snapshot = resolveZedSelection({ dbPath, cwd: ctx.cwd, env });
    } catch {
      snapshot = undefined;
    }

    if (snapshot) {
      const key = snapshotKey(snapshot);
      if (key !== runtime.zedPollSelectionKey) {
        runtime.zedPollSelectionKey = key;
        setLatestSelection(runtime, snapshot, ctx as ExtensionContext);
      }
    } else {
      clearLatestSelection(runtime, ctx as ExtensionContext);
    }
    return "continue";
  };

  const program = Effect.gen(function* () {
    while (true) {
      // Match previous setTimeout behavior: wait interval, then poll.
      yield* Effect.sleep(`${intervalMs} millis`);
      let outcome: "continue" | "stop" | "error";
      let pollError: unknown;
      try {
        outcome = pollTick();
      } catch (error) {
        outcome = "error";
        pollError = error;
      }
      if (outcome === "error") {
        // Clear handles without interrupting self; contain like the timer path.
        runtime.zedPollFiber = undefined;
        runtime.zedPollIntervalMs = undefined;
        runtime.zedPollSelectionKey = undefined;
        runtime.zedPollWalMtimeMs = undefined;
        containPiError(runtime, "Zed polling", pollError, ctx as ExtensionContext);
        return;
      }
      if (outcome === "stop") return;
    }
  });

  const fiber = Effect.runFork(
    program.pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (runtime.zedPollFiber === fiber) {
            runtime.zedPollFiber = undefined;
            runtime.zedPollIntervalMs = undefined;
          }
        }),
      ),
    ),
  );
  runtime.zedPollFiber = fiber;
  return true;
}
