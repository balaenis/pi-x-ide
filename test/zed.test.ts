import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { DatabaseSync } from "node:sqlite";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent" with {
  "resolution-mode": "import",
};
import { createRuntime } from "../src/pi/state";
import { CONFIG_DIR_NAME, resolvePiConfigEnv } from "../src/shared/config";
import type { LockFileCandidate } from "../src/shared/protocol";
import {
  isZedTerminal,
  isWsl,
  normalizeZedPathForHost,
  resolveZedDbPath,
  parseZedWorkspacePaths,
  resolveZedSelection,
  startZedPolling,
  stopZedPolling,
  PI_X_IDE_ZED_DB_ENV,
  PI_X_IDE_ZED_POLL_INTERVAL_MS_ENV,
} from "../src/pi/zed";

// ── Env / path detection ──────────────────────────────────────

void test("isZedTerminal detects Zed env markers", () => {
  assert.equal(isZedTerminal({}), false);
  assert.equal(isZedTerminal({ ZED_TERM: "true" }), true);
  assert.equal(isZedTerminal({ TERM_PROGRAM: "zed" }), true);
  assert.equal(isZedTerminal({ TERM_PROGRAM: "ZED" }), true);
  assert.equal(isZedTerminal({ ZED_TERM: "true", TERM_PROGRAM: "vscode" }), true);
  assert.equal(isZedTerminal({ TERM_PROGRAM: "vscode" }), false);
});

void test("isWsl detects WSL env markers", () => {
  assert.equal(isWsl({ WSL_DISTRO_NAME: "Ubuntu" }), true);
  assert.equal(isWsl({ WSL_INTEROP: "/run/WSL/1_interop" }), true);
  assert.equal(isWsl({}), false);
});

void test("normalizeZedPathForHost maps Windows paths for WSL", () => {
  assert.equal(
    normalizeZedPathForHost("C:\\Users\\czllo\\project\\src\\main.ts", { WSL_DISTRO_NAME: "Ubuntu" }),
    "/mnt/c/Users/czllo/project/src/main.ts",
  );
  assert.equal(
    normalizeZedPathForHost("D:/work/repo/file.ts", { WSL_DISTRO_NAME: "Ubuntu" }),
    "/mnt/d/work/repo/file.ts",
  );
});

void test("normalizeZedPathForHost maps matching WSL UNC paths", () => {
  assert.equal(
    normalizeZedPathForHost("\\\\wsl.localhost\\Ubuntu\\home\\julian\\project\\file.ts", {
      WSL_DISTRO_NAME: "Ubuntu",
    }),
    "/home/julian/project/file.ts",
  );
  assert.equal(
    normalizeZedPathForHost("\\\\wsl$\\Ubuntu\\home\\julian\\project\\file.ts", { WSL_DISTRO_NAME: "Ubuntu" }),
    "/home/julian/project/file.ts",
  );
});

void test("normalizeZedPathForHost leaves other distro UNC paths untouched", () => {
  const path = "\\\\wsl.localhost\\Debian\\home\\julian\\project\\file.ts";
  assert.equal(normalizeZedPathForHost(path, { WSL_DISTRO_NAME: "Ubuntu" }), path);
});

void test("resolveZedDbPath detects Windows LOCALAPPDATA path in WSL", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-x-ide-zed-localappdata-"));
  const localAppData = join(root, "AppData", "Local");
  const dbPath = join(localAppData, "Zed", "db", "0-stable", "db.sqlite");
  await mkdir(join(localAppData, "Zed", "db", "0-stable"), { recursive: true });
  await writeFile(dbPath, "{}");
  after(() => rm(root, { recursive: true, force: true }).catch(() => undefined));

  assert.equal(resolveZedDbPath({ WSL_DISTRO_NAME: "Ubuntu", LOCALAPPDATA: localAppData }, "/home/test"), dbPath);
});

void test("resolveZedDbPath respects env override", async () => {
  const pkgPath = join(tmpdir(), "pi-x-ide-zed-test-package.json");
  await writeFile(pkgPath, "{}");
  after(() => rm(pkgPath, { force: true }).catch(() => undefined));

  const result = resolveZedDbPath({ [PI_X_IDE_ZED_DB_ENV]: pkgPath }, "/home/test");
  assert.equal(result, pkgPath);
});

void test("resolveZedDbPath respects pi config env override", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-x-ide-zed-config-"));
  const configDir = join(root, CONFIG_DIR_NAME);
  const configPath = join(configDir, "config.json");
  const dbPath = join(root, "db.sqlite");
  await mkdir(configDir, { recursive: true });
  await writeFile(dbPath, "{}");
  await writeFile(configPath, JSON.stringify({ env: { [PI_X_IDE_ZED_DB_ENV]: dbPath } }));
  after(() => rm(root, { recursive: true, force: true }).catch(() => undefined));

  assert.equal(resolveZedDbPath(resolvePiConfigEnv({}, { configPath }), "/home/test"), dbPath);
});

void test("resolveZedDbPath ignores missing env override", () => {
  const missingPath = join(tmpdir(), "pi-x-ide-zed-missing-db.sqlite");
  const result = resolveZedDbPath({ [PI_X_IDE_ZED_DB_ENV]: missingPath }, "/home/test");
  assert.equal(result, undefined);
});

void test("resolveZedDbPath detects Windows default path", async () => {
  const home = await mkdtemp(join(tmpdir(), "pi-x-ide-zed-home-"));
  const dbPath = join(home, "AppData", "Local", "Zed", "db", "0-stable", "db.sqlite");
  await mkdir(join(home, "AppData", "Local", "Zed", "db", "0-stable"), { recursive: true });
  await writeFile(dbPath, "{}");
  after(() => rm(home, { recursive: true, force: true }).catch(() => undefined));

  assert.equal(resolveZedDbPath({}, home), dbPath);
});

void test("resolveZedDbPath returns undefined when no DB exists", () => {
  const result = resolveZedDbPath({}, "/nonexistent-home");
  assert.equal(result, undefined);
});

// ── Workspace paths ──────────────────────────────────────────

void test("parseZedWorkspacePaths handles JSON array", () => {
  assert.deepEqual(parseZedWorkspacePaths('["/repo", "/other"]'), ["/repo", "/other"]);
});

void test("parseZedWorkspacePaths handles newline-delimited paths", () => {
  assert.deepEqual(parseZedWorkspacePaths("/repo\n/other"), ["/repo", "/other"]);
  assert.deepEqual(parseZedWorkspacePaths("/repo\n/other\n"), ["/repo", "/other"]);
});

void test("parseZedWorkspacePaths handles null, empty, and malformed JSON", () => {
  assert.deepEqual(parseZedWorkspacePaths(null), []);
  assert.deepEqual(parseZedWorkspacePaths(""), []);
  assert.deepEqual(parseZedWorkspacePaths("   "), []);
  assert.deepEqual(parseZedWorkspacePaths("{not json"), []);
});

// ── DB fixture helpers ──────────────────────────────────────

interface Fixture {
  dir: string;
  dbPath: string;
  cleanup: () => Promise<void>;
}

async function createFixture(): Promise<Fixture> {
  const dir = await mkdtemp(join(tmpdir(), "pi-x-ide-zed-test-"));
  const dbPath = join(dir, "db.sqlite");
  const db = new DatabaseSync(dbPath);

  db.exec(`
    CREATE TABLE workspaces (
      workspace_id TEXT PRIMARY KEY,
      paths TEXT,
      timestamp INTEGER
    );
    CREATE TABLE panes (
      pane_id TEXT PRIMARY KEY,
      workspace_id TEXT,
      active INTEGER
    );
    CREATE TABLE items (
      item_id TEXT PRIMARY KEY,
      workspace_id TEXT,
      pane_id TEXT,
      kind TEXT,
      active INTEGER
    );
    CREATE TABLE editors (
      item_id TEXT,
      workspace_id TEXT,
      buffer_path TEXT,
      contents TEXT,
      PRIMARY KEY (item_id, workspace_id)
    );
    CREATE TABLE editor_selections (
      editor_id TEXT,
      workspace_id TEXT,
      start INTEGER,
      end INTEGER
    );
  `);

  db.close();

  async function cleanup() {
    await rm(dir, { recursive: true, force: true });
  }

  return { dir, dbPath, cleanup };
}

async function createNumericFixture(): Promise<Fixture> {
  const dir = await mkdtemp(join(tmpdir(), "pi-x-ide-zed-numeric-"));
  const dbPath = join(dir, "db.sqlite");
  const db = new DatabaseSync(dbPath);

  db.exec(`
    CREATE TABLE workspaces (
      workspace_id INTEGER PRIMARY KEY,
      paths TEXT,
      timestamp INTEGER
    );
    CREATE TABLE panes (
      pane_id INTEGER PRIMARY KEY,
      workspace_id INTEGER,
      active INTEGER
    );
    CREATE TABLE items (
      item_id INTEGER PRIMARY KEY,
      workspace_id INTEGER,
      pane_id INTEGER,
      kind TEXT,
      active INTEGER
    );
    CREATE TABLE editors (
      item_id INTEGER,
      workspace_id INTEGER,
      buffer_path TEXT,
      contents TEXT,
      PRIMARY KEY (item_id, workspace_id)
    );
    CREATE TABLE editor_selections (
      editor_id INTEGER,
      workspace_id INTEGER,
      start INTEGER,
      end INTEGER
    );
  `);

  db.close();

  async function cleanup() {
    await rm(dir, { recursive: true, force: true });
  }

  return { dir, dbPath, cleanup };
}

function openFixture(dbPath: string): DatabaseSync {
  return new DatabaseSync(dbPath);
}

function insertWorkspace(db: DatabaseSync, wsId: string, paths: string, ts: number): void {
  db.prepare("INSERT INTO workspaces VALUES (?, ?, ?)").run(wsId, paths, ts);
}

function insertPane(db: DatabaseSync, paneId: string, wsId: string, active: number): void {
  db.prepare("INSERT INTO panes VALUES (?, ?, ?)").run(paneId, wsId, active);
}

function insertItem(
  db: DatabaseSync,
  itemId: string,
  wsId: string,
  paneId: string,
  kind: string,
  active: number,
): void {
  db.prepare("INSERT INTO items VALUES (?, ?, ?, ?, ?)").run(itemId, wsId, paneId, kind, active);
}

function insertEditor(db: DatabaseSync, itemId: string, wsId: string, bufferPath: string, contents: string): void {
  db.prepare("INSERT INTO editors VALUES (?, ?, ?, ?)").run(itemId, wsId, bufferPath, contents);
}

function insertSelection(db: DatabaseSync, editorId: string, wsId: string, start: number, end: number): void {
  db.prepare("INSERT INTO editor_selections VALUES (?, ?, ?, ?)").run(editorId, wsId, start, end);
}

// ── resolveZedSelection ──────────────────────────────────────

void test("returns active editor snapshot with selected text", async () => {
  const { dir, dbPath, cleanup } = await createFixture();
  after(cleanup);

  const db = openFixture(dbPath);
  insertWorkspace(db, "w1", JSON.stringify([dir]), Date.now());
  insertPane(db, "p1", "w1", 1);
  insertItem(db, "i1", "w1", "p1", "Editor", 1);
  insertEditor(db, "i1", "w1", join(dir, "src/main.ts"), "hello world\nconst x = 1;\n");
  insertSelection(db, "i1", "w1", 0, 5);
  db.close();

  const snapshot = resolveZedSelection({ dbPath, cwd: dir, now: 12345 });
  assert.ok(snapshot);
  assert.equal(snapshot.receivedAt, 12345);
  assert.equal(snapshot.source, "zed");
  assert.equal(snapshot.workspaceFolder, dir);
  assert.equal(snapshot.filePath, join(dir, "src/main.ts"));
  assert.equal(snapshot.ranges.length, 1);
  assert.equal(snapshot.ranges[0].text, "hello");
  assert.equal(snapshot.ranges[0].selection.start.line, 0);
  assert.equal(snapshot.ranges[0].selection.start.character, 0);
  assert.equal(snapshot.ranges[0].selection.end.line, 0);
  assert.equal(snapshot.ranges[0].selection.end.character, 5);
});

void test("returns active editor snapshot with numeric IDs (real Zed schema)", async () => {
  // Zed's actual database uses INTEGER PRIMARY KEYs, not TEXT.
  // node:sqlite returns them as JS numbers. The filter must accept both.
  const { dir, dbPath, cleanup } = await createNumericFixture();
  after(cleanup);

  const db = openFixture(dbPath);
  db.prepare("INSERT INTO workspaces VALUES (?, ?, ?)").run(1, JSON.stringify([dir]), Date.now());
  db.prepare("INSERT INTO panes VALUES (?, ?, ?)").run(1, 1, 1);
  db.prepare("INSERT INTO items VALUES (?, ?, ?, ?, ?)").run(1, 1, 1, "Editor", 1);
  db.prepare("INSERT INTO editors VALUES (?, ?, ?, ?)").run(1, 1, join(dir, "src/main.ts"), "hello world\n");
  db.prepare("INSERT INTO editor_selections VALUES (?, ?, ?, ?)").run(1, 1, 0, 5);
  db.close();

  const snapshot = resolveZedSelection({ dbPath, cwd: dir, now: 12345 });
  assert.ok(snapshot);
  assert.equal(snapshot.source, "zed");
  assert.equal(snapshot.ranges[0].text, "hello");
});

void test("matches Windows workspace paths when running in WSL", async () => {
  const { dbPath, cleanup } = await createFixture();
  after(cleanup);

  const db = openFixture(dbPath);
  insertWorkspace(db, "w1", JSON.stringify(["C:\\Users\\czllo\\project"]), Date.now());
  insertPane(db, "p1", "w1", 1);
  insertItem(db, "i1", "w1", "p1", "Editor", 1);
  insertEditor(db, "i1", "w1", "C:\\Users\\czllo\\project\\src\\main.ts", "windows content");
  insertSelection(db, "i1", "w1", 0, 7);
  db.close();

  const snapshot = resolveZedSelection({
    dbPath,
    cwd: "/mnt/c/Users/czllo/project",
    env: { WSL_DISTRO_NAME: "Ubuntu" },
  });

  assert.ok(snapshot);
  assert.equal(snapshot.workspaceFolder, "/mnt/c/Users/czllo/project");
  assert.equal(snapshot.filePath, "/mnt/c/Users/czllo/project/src/main.ts");
  assert.equal(snapshot.ranges[0].text, "windows");
});

void test("matches WSL UNC workspace paths when running in WSL", async () => {
  const { dbPath, cleanup } = await createFixture();
  after(cleanup);

  const db = openFixture(dbPath);
  insertWorkspace(db, "w1", JSON.stringify(["\\\\wsl.localhost\\Ubuntu\\home\\julian\\project"]), Date.now());
  insertPane(db, "p1", "w1", 1);
  insertItem(db, "i1", "w1", "p1", "Editor", 1);
  insertEditor(db, "i1", "w1", "\\\\wsl.localhost\\Ubuntu\\home\\julian\\project\\src\\main.ts", "unc content");
  insertSelection(db, "i1", "w1", 0, 3);
  db.close();

  const snapshot = resolveZedSelection({
    dbPath,
    cwd: "/home/julian/project",
    env: { WSL_DISTRO_NAME: "Ubuntu" },
  });

  assert.ok(snapshot);
  assert.equal(snapshot.workspaceFolder, "/home/julian/project");
  assert.equal(snapshot.filePath, "/home/julian/project/src/main.ts");
  assert.equal(snapshot.ranges[0].text, "unc");
});

void test("returns snapshot with ranges [] when selection is empty caret", async () => {
  const { dir, dbPath, cleanup } = await createFixture();
  after(cleanup);

  const db = openFixture(dbPath);
  insertWorkspace(db, "w1", JSON.stringify([dir]), Date.now());
  insertPane(db, "p1", "w1", 1);
  insertItem(db, "i1", "w1", "p1", "Editor", 1);
  insertEditor(db, "i1", "w1", join(dir, "src/main.ts"), "hello");
  insertSelection(db, "i1", "w1", 3, 3);
  db.close();

  const snapshot = resolveZedSelection({ dbPath, cwd: dir });
  assert.ok(snapshot);
  assert.equal(snapshot.ranges.length, 0);
});

void test("returns active empty file snapshot", async () => {
  const { dir, dbPath, cleanup } = await createFixture();
  after(cleanup);

  const db = openFixture(dbPath);
  insertWorkspace(db, "w1", JSON.stringify([dir]), Date.now());
  insertPane(db, "p1", "w1", 1);
  insertItem(db, "i1", "w1", "p1", "Editor", 1);
  insertEditor(db, "i1", "w1", join(dir, "empty.ts"), "");
  db.close();

  const snapshot = resolveZedSelection({ dbPath, cwd: dir, readFile: () => "" });
  assert.ok(snapshot);
  assert.equal(snapshot.filePath, join(dir, "empty.ts"));
  assert.equal(snapshot.ranges.length, 0);
});

void test("returns undefined when schema is missing", async () => {
  const { dir, dbPath, cleanup } = await createFixture();
  after(cleanup);
  await rm(dbPath, { force: true });
  const db = openFixture(dbPath);
  db.exec("CREATE TABLE unrelated (id TEXT)");
  db.close();

  assert.equal(resolveZedSelection({ dbPath, cwd: dir }), undefined);
});

void test("skips Terminal items", async () => {
  const { dir, dbPath, cleanup } = await createFixture();
  after(cleanup);

  const db = openFixture(dbPath);
  insertWorkspace(db, "w1", JSON.stringify([dir]), Date.now());
  insertPane(db, "p1", "w1", 1);
  insertItem(db, "i1", "w1", "p1", "Terminal", 1);
  db.close();

  const snapshot = resolveZedSelection({ dbPath, cwd: dir });
  assert.equal(snapshot, undefined);
});

void test("returns undefined when DB is empty", async () => {
  const { dir, dbPath, cleanup } = await createFixture();
  after(cleanup);

  const snapshot = resolveZedSelection({ dbPath, cwd: dir });
  assert.equal(snapshot, undefined);
});

void test("picks workspace with longest matching path", async () => {
  const { dir, dbPath, cleanup } = await createFixture();
  after(cleanup);

  const db = openFixture(dbPath);
  const base = join(dir, "projects");
  const child = join(base, "app");

  insertWorkspace(db, "w-broad", JSON.stringify([base]), 1000);
  insertPane(db, "pb", "w-broad", 1);
  insertItem(db, "ib", "w-broad", "pb", "Editor", 1);
  insertEditor(db, "ib", "w-broad", join(base, "README.md"), "broad");
  insertSelection(db, "ib", "w-broad", 0, 1);

  insertWorkspace(db, "w-narrow", JSON.stringify([child]), 2000);
  insertPane(db, "pn", "w-narrow", 1);
  insertItem(db, "in", "w-narrow", "pn", "Editor", 1);
  insertEditor(db, "in", "w-narrow", join(child, "src/main.ts"), "narrow");
  insertSelection(db, "in", "w-narrow", 0, 2);

  db.close();

  const snapshot = resolveZedSelection({ dbPath, cwd: child });
  assert.ok(snapshot);
  assert.equal(snapshot.ranges[0].text, "na"); // w-narrow wins
});

void test("normalizes reversed selections", async () => {
  const { dir, dbPath, cleanup } = await createFixture();
  after(cleanup);

  const db = openFixture(dbPath);
  insertWorkspace(db, "w1", JSON.stringify([dir]), Date.now());
  insertPane(db, "p1", "w1", 1);
  insertItem(db, "i1", "w1", "p1", "Editor", 1);
  insertEditor(db, "i1", "w1", join(dir, "src/main.ts"), "abcdefghij");
  // reversed: end < start
  insertSelection(db, "i1", "w1", 5, 1);
  db.close();

  const snapshot = resolveZedSelection({ dbPath, cwd: dir });
  assert.ok(snapshot);
  assert.equal(snapshot.ranges[0].text, "bcde"); // chars at bytes 1-5
  assert.equal(snapshot.ranges[0].selection.start.character, 1);
  assert.equal(snapshot.ranges[0].selection.end.character, 5);
});

void test("converts UTF-8 multi-byte offsets in selection", async () => {
  const { dir, dbPath, cleanup } = await createFixture();
  after(cleanup);

  const text = "a€c🌟e"; // € = 3 bytes, 🌟 = 4 bytes (UTF-8)
  // byte offsets: a=1, €=4(1+3), c=5, 🌟=9(5+4), e=10
  const db = openFixture(dbPath);
  insertWorkspace(db, "w1", JSON.stringify([dir]), Date.now());
  insertPane(db, "p1", "w1", 1);
  insertItem(db, "i1", "w1", "p1", "Editor", 1);
  insertEditor(db, "i1", "w1", join(dir, "src/main.ts"), text);
  // select from € (byte 1) through 🌟 (byte 9)
  insertSelection(db, "i1", "w1", 1, 9);
  db.close();

  const snapshot = resolveZedSelection({ dbPath, cwd: dir });
  assert.ok(snapshot);
  // should be "€c🌟" — chars from index 1 to index 4
  assert.equal(snapshot.ranges[0].text, "€c🌟");
  assert.equal(snapshot.ranges[0].selection.start.line, 0);
  assert.equal(snapshot.ranges[0].selection.start.character, 1);
  assert.equal(snapshot.ranges[0].selection.end.line, 0);
  assert.equal(snapshot.ranges[0].selection.end.character, 5);
});

void test("handles multi-byte emoji selection at boundary", async () => {
  const { dir, dbPath, cleanup } = await createFixture();
  after(cleanup);

  const text = "hello 🎉 world"; // 🎉 = 4 bytes
  const db = openFixture(dbPath);
  insertWorkspace(db, "w1", JSON.stringify([dir]), Date.now());
  insertPane(db, "p1", "w1", 1);
  insertItem(db, "i1", "w1", "p1", "Editor", 1);
  insertEditor(db, "i1", "w1", join(dir, "src/main.ts"), text);
  // select just the emoji: byte offset 6 (start of 🎉) to 10 (end of 🎉)
  insertSelection(db, "i1", "w1", 6, 10);
  db.close();

  const snapshot = resolveZedSelection({ dbPath, cwd: dir });
  assert.ok(snapshot);
  assert.equal(snapshot.ranges[0].text, "🎉");
  assert.equal(snapshot.ranges[0].selection.start.line, 0);
  assert.equal(snapshot.ranges[0].selection.start.character, 6);
  assert.equal(snapshot.ranges[0].selection.end.line, 0);
  assert.equal(snapshot.ranges[0].selection.end.character, 8);
});

void test("falls back to contents column when file does not exist on disk", async () => {
  const { dir, dbPath, cleanup } = await createFixture();
  after(cleanup);

  const db = openFixture(dbPath);
  insertWorkspace(db, "w1", JSON.stringify([dir]), Date.now());
  insertPane(db, "p1", "w1", 1);
  insertItem(db, "i1", "w1", "p1", "Editor", 1);
  const bufferPath = join(dir, "unsaved-buffer.ts");
  insertEditor(db, "i1", "w1", bufferPath, "inline content here");
  insertSelection(db, "i1", "w1", 0, 6);
  db.close();

  const snapshot = resolveZedSelection({ dbPath, cwd: dir });
  assert.ok(snapshot);
  assert.equal(snapshot.ranges[0].text, "inline");
});

void test("handles multi-line selection", async () => {
  const { dir, dbPath, cleanup } = await createFixture();
  after(cleanup);

  const text = "line1\nline2\nline3\n";
  const db = openFixture(dbPath);
  insertWorkspace(db, "w1", JSON.stringify([dir]), Date.now());
  insertPane(db, "p1", "w1", 1);
  insertItem(db, "i1", "w1", "p1", "Editor", 1);
  insertEditor(db, "i1", "w1", join(dir, "src/main.ts"), text);
  // select "ne2\nline3": bytes 8 to 17
  insertSelection(db, "i1", "w1", 8, 17);
  db.close();

  const snapshot = resolveZedSelection({ dbPath, cwd: dir });
  assert.ok(snapshot);
  assert.equal(snapshot.ranges[0].text, "ne2\nline3");
  assert.equal(snapshot.ranges[0].selection.start.line, 1);
  assert.equal(snapshot.ranges[0].selection.start.character, 2);
  assert.equal(snapshot.ranges[0].selection.end.line, 2);
  assert.equal(snapshot.ranges[0].selection.end.character, 5);
});

void test("handles multiple selections (multi-cursor)", async () => {
  const { dir, dbPath, cleanup } = await createFixture();
  after(cleanup);

  const text = "abc\ndef\nghi\n";
  const db = openFixture(dbPath);
  insertWorkspace(db, "w1", JSON.stringify([dir]), Date.now());
  insertPane(db, "p1", "w1", 1);
  insertItem(db, "i1", "w1", "p1", "Editor", 1);
  insertEditor(db, "i1", "w1", join(dir, "src/main.ts"), text);
  insertSelection(db, "i1", "w1", 0, 1);
  insertSelection(db, "i1", "w1", 5, 6);
  db.close();

  const snapshot = resolveZedSelection({ dbPath, cwd: dir });
  assert.ok(snapshot);
  assert.equal(snapshot.ranges.length, 2);
  assert.equal(snapshot.ranges[0].text, "a");
  assert.equal(snapshot.ranges[1].text, "e");
});

void test("newline workspace paths are parsed", async () => {
  const { dir, dbPath, cleanup } = await createFixture();
  after(cleanup);

  const db = openFixture(dbPath);
  insertWorkspace(db, "w1", dir + "\n/tmp/other", Date.now());
  insertPane(db, "p1", "w1", 1);
  insertItem(db, "i1", "w1", "p1", "Editor", 1);
  insertEditor(db, "i1", "w1", join(dir, "src/main.ts"), "x");
  insertSelection(db, "i1", "w1", 0, 1);
  db.close();

  const snapshot = resolveZedSelection({ dbPath, cwd: dir });
  assert.ok(snapshot);
  assert.equal(snapshot.workspaceFolder, dir);
});

// ── Polling lifecycle ─────────────────────────────────────────

void test("stopZedPolling clears timer and selection key", () => {
  const runtime = createRuntime();
  runtime.zedPollTimer = setTimeout(() => {}, 999_999);
  runtime.zedPollSelectionKey = "some-key";
  stopZedPolling(runtime);
  assert.equal(runtime.zedPollTimer, undefined);
  assert.equal(runtime.zedPollSelectionKey, undefined);
});

void test("stopZedPolling is idempotent", () => {
  const runtime = createRuntime();
  stopZedPolling(runtime);
  stopZedPolling(runtime);
  assert.equal(runtime.zedPollTimer, undefined);
});

function createContext(cwd = "/tmp"): ExtensionContext {
  return {
    cwd,
    hasUI: false,
    ui: { setWidget: () => {}, notify: () => {}, select: () => Promise.resolve(undefined), pasteToEditor: () => {} },
  } as unknown as ExtensionContext;
}

function createCandidate(workspaceFolder = "/tmp"): LockFileCandidate {
  return {
    path: "/tmp/stale.lock",
    lock: {
      version: 1,
      ide: "vscode",
      name: "VS Code",
      transport: "ws",
      host: "127.0.0.1",
      port: 49152,
      authToken: "token",
      workspaceFolders: [workspaceFolder],
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    },
    mtimeMs: 0,
    matchLength: 1,
    workspaceFolder,
  };
}

void test("startZedPolling returns false when not in Zed terminal", () => {
  const runtime = createRuntime();
  const result = startZedPolling(runtime, createContext(), { env: {} });
  assert.equal(result, false);
  assert.equal(runtime.zedPollTimer, undefined);
});

void test("startZedPolling returns false when DB path not found", () => {
  const runtime = createRuntime();
  const result = startZedPolling(runtime, createContext(), { env: { ZED_TERM: "true" } });
  assert.equal(result, false);
  assert.equal(runtime.zedPollTimer, undefined);
});

void test("startZedPolling clamps configured poll interval", async () => {
  const { dir, dbPath, cleanup } = await createFixture();
  after(cleanup);

  const cases = [
    { value: "1", expected: 100 },
    { value: "250", expected: 250 },
    { value: "5000", expected: 2000 },
  ];

  for (const { value, expected } of cases) {
    const runtime = createRuntime();
    const started = startZedPolling(runtime, createContext(dir), {
      dbPath,
      env: { ZED_TERM: "true", [PI_X_IDE_ZED_POLL_INTERVAL_MS_ENV]: value },
    });

    assert.equal(started, true);
    assert.equal((runtime.zedPollTimer as NodeJS.Timeout & { _idleTimeout?: number })._idleTimeout, expected);
    stopZedPolling(runtime);
  }
});

void test("startZedPolling clears stale WebSocket candidate state", async () => {
  const { dir, dbPath, cleanup } = await createFixture();
  after(cleanup);

  const runtime = createRuntime();
  runtime.currentCandidate = createCandidate(dir);
  runtime.connectionStatus = "error";

  const started = startZedPolling(runtime, createContext(dir), {
    dbPath,
    env: { ZED_TERM: "true" },
    intervalMs: 999_999,
  });

  assert.equal(started, true);
  assert.equal(runtime.currentCandidate, undefined);
  assert.equal(runtime.connection, undefined);
  assert.equal(runtime.connectedServer?.ide, "zed");
  assert.equal(runtime.connectionStatus, "connected");
  stopZedPolling(runtime);
});
