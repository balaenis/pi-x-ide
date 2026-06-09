import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { formatEditorContext, formatRangeMention, parseRangeMention } from "../src/shared/format";
import { relationshipMatchLength } from "../src/shared/paths";
import type { EditorSelectionSnapshot, IdeLockFile } from "../src/shared/protocol";
import { parseLockFileContent } from "../src/shared/schema";
import { discoverIdeCandidates } from "../src/pi/discovery";

const snapshot: EditorSelectionSnapshot = {
  source: "vscode",
  filePath: "/repo/src/main.ts",
  workspaceFolder: "/repo",
  ranges: [
    {
      text: "const x = 1;",
      selection: {
        start: { line: 9, character: 0 },
        end: { line: 19, character: 12 },
      },
    },
  ],
};

test("formats and parses range mentions", () => {
  assert.equal(formatRangeMention(snapshot), "@src/main.ts#L10,20");
  assert.deepEqual(parseRangeMention("@src/main.ts#L10,20"), { path: "src/main.ts", startLine: 10, endLine: 20 });
  assert.deepEqual(parseRangeMention("@src/main.ts#L10-L20"), { path: "src/main.ts", startLine: 10, endLine: 20 });
  assert.deepEqual(parseRangeMention("@src/main.ts#L10"), { path: "src/main.ts", startLine: 10, endLine: 10 });
});

test("formats bounded editor context", () => {
  const context = formatEditorContext(snapshot, { maxChars: 6 });
  assert.match(context, /src\/main\.ts/);
  assert.match(context, /lines 10-20/);
  assert.match(context, /truncated/i);
});

test("validates lock file content", () => {
  const lock: IdeLockFile = {
    version: 1,
    ide: "vscode",
    name: "Visual Studio Code",
    transport: "ws",
    host: "127.0.0.1",
    port: 49152,
    authToken: "token",
    workspaceFolders: ["/repo"],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  assert.deepEqual(parseLockFileContent(JSON.stringify(lock)), lock);
  assert.equal(parseLockFileContent(JSON.stringify({ ...lock, port: 99999 })), undefined);
});

test("matches workspace relationship", () => {
  assert.ok(relationshipMatchLength("/repo/src", "/repo/src/app") > relationshipMatchLength("/repo", "/repo/src/app"));
  assert.equal(relationshipMatchLength("/other", "/repo"), 0);
});

test("discovers and sorts matching lock files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-x-ide-test-"));
  const baseLock: IdeLockFile = {
    version: 1,
    ide: "vscode",
    name: "VS Code",
    transport: "ws",
    host: "127.0.0.1",
    port: 40000,
    authToken: "token",
    workspaceFolders: ["/repo"],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await writeFile(join(dir, "a.lock"), JSON.stringify(baseLock));
  await writeFile(join(dir, "b.lock"), JSON.stringify({ ...baseLock, port: 40001, workspaceFolders: ["/repo/src"] }));
  await writeFile(join(dir, "bad.lock"), "not json");

  const candidates = await discoverIdeCandidates({ cwd: "/repo/src/app", lockDir: dir, checkPid: false });
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0]!.lock.port, 40001);
});
