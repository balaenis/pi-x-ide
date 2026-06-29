// ABOUTME: Exercises shared protocol, config, path, and runtime selection helper behavior.
// ABOUTME: Covers regression cases for stale pi extension context handling.
import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  CONFIG_DIR_NAME,
  EXT_CONFIG_NAME,
  readPiConfigEnv,
  readPiConfigFixPrompt,
  resolvePiConfigEnv,
} from "../src/shared/config";
import { visibleWidth } from "../src/shared/display-width";
import { formatEditorContext, formatRangeMention, parseRangeMention } from "../src/shared/format";
import { hasDirectWorkspaceMatch, relationshipMatchLength, resolveLockDir, resolveLockDirs } from "../src/shared/paths";
import {
  isWsl,
  normalizeEditorSelectionSnapshotForHost,
  normalizePathForHost,
  windowsUserProfileDirs,
} from "../src/shared/platform";
import { type EditorSelectionSnapshot, type IdeLockFile } from "../src/shared/protocol";
import { createIdeLockFile } from "../src/shared/lock-file";
import { parseLockFileContent, isSelectionClearedParams, isEditorSelectionSnapshot } from "../src/shared/schema";
import { discoverIdeCandidates } from "../src/pi/discovery";
import { clearLatestSelection, setLatestSelection } from "../src/pi/context";
import { createRuntime } from "../src/pi/state";
import { updateIdeUi } from "../src/pi/ui";

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

function captureConsoleErrors(action: () => void): string[] {
  const original = console.error;
  const messages: string[] = [];
  console.error = (...args: unknown[]) => {
    messages.push(args.map(String).join(" "));
  };
  try {
    action();
  } finally {
    console.error = original;
  }
  return messages;
}

void test("formats and parses range mentions", () => {
  assert.equal(formatRangeMention(snapshot), "@src/main.ts#L10-L20");
  assert.deepEqual(parseRangeMention("@src/main.ts#L10-L20"), {
    path: "src/main.ts",
    startLine: 10,
    endLine: 20,
  });
  assert.deepEqual(parseRangeMention("@src/main.ts#L10"), {
    path: "src/main.ts",
    startLine: 10,
    endLine: 10,
  });
  // The legacy comma separator is no longer a range; it stays part of the path.
  assert.deepEqual(parseRangeMention("@src/main.ts#L10,20"), {
    path: "src/main.ts#L10,20",
    startLine: undefined,
    endLine: undefined,
  });
});

void test("formats bounded editor context", () => {
  const context = formatEditorContext(snapshot, { maxChars: 6 });
  assert.match(context, /src\/main\.ts/);
  assert.match(context, /L10-L20/);
  assert.match(context, /truncated/i);
});

void test("validates selection cleared params", () => {
  assert.equal(isSelectionClearedParams({ source: "vscode", reason: "no-active-editor" }), true);
  assert.equal(isSelectionClearedParams({ source: "vscode", reason: "no-active-editor", receivedAt: 123 }), true);
  assert.equal(isSelectionClearedParams({ source: "vscode", reason: "unknown" }), false);
  assert.equal(isSelectionClearedParams({ source: "vscode" }), false);
});

void test("clears stale editor selection state", () => {
  const runtime = createRuntime();
  setLatestSelection(runtime, snapshot);

  assert.equal(runtime.latestSelection, snapshot);
  assert.equal(runtime.attachState, "pending");

  clearLatestSelection(runtime);

  assert.equal(runtime.latestSelection, undefined);
  assert.equal(runtime.latestSelectionKey, undefined);
  assert.equal(runtime.turnSelection, undefined);
  assert.equal(runtime.attachState, "idle");
});

void test("logs stale extension ctx while updating selection UI", () => {
  const runtime = createRuntime();
  runtime.ctx = {
    get hasUI(): boolean {
      throw new Error("This extension ctx is stale after session replacement or reload.");
    },
  } as NonNullable<typeof runtime.ctx>;

  const errors = captureConsoleErrors(() => {
    assert.doesNotThrow(() => setLatestSelection(runtime, snapshot));
  });
  assert.equal(runtime.latestSelection, snapshot);
  assert.equal(runtime.attachState, "pending");
  assert.equal(errors.length, 1);
  assert.match(errors[0] ?? "", /read active Pi UI context: This extension ctx is stale/);
});

void test("logs non-stale extension ctx errors while updating selection UI", () => {
  const runtime = createRuntime();
  runtime.ctx = {
    get hasUI(): boolean {
      throw new Error("unexpected UI failure");
    },
  } as NonNullable<typeof runtime.ctx>;

  const errors = captureConsoleErrors(() => {
    assert.doesNotThrow(() => setLatestSelection(runtime, snapshot));
  });
  assert.equal(runtime.latestSelection, snapshot);
  assert.equal(errors.length, 1);
  assert.match(errors[0] ?? "", /read active Pi UI context: unexpected UI failure/);
});

void test("logs IDE widget render errors without throwing", () => {
  const runtime = createRuntime();
  runtime.connectionStatus = "connected";
  let widgetFactory:
    | ((
        tui: { requestRender: () => void },
        theme: { fg: (color: string, text: string) => string },
      ) => { render: (width: number) => string[]; invalidate: () => void; dispose: () => void })
    | undefined;
  const ctx = {
    cwd: "/repo",
    hasUI: true,
    ui: {
      setWidget: (_id: string, factory: typeof widgetFactory) => {
        widgetFactory = factory;
      },
    },
  } as unknown as NonNullable<typeof runtime.ctx>;

  updateIdeUi(runtime, ctx);
  if (!widgetFactory) assert.fail("widget factory was not registered");
  const widget = widgetFactory(
    { requestRender: () => undefined },
    {
      fg: () => {
        throw new Error("theme failure");
      },
    },
  );

  const errors = captureConsoleErrors(() => {
    assert.deepEqual(widget.render(10), []);
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0] ?? "", /render IDE UI widget: theme failure/);
});

void test("truncates IDE widget output by terminal cell width", () => {
  const runtime = createRuntime();
  runtime.connectionStatus = "connected";
  setLatestSelection(runtime, {
    ...snapshot,
    filePath: `/repo/${"한글".repeat(80)}.ts`,
    ranges: [],
  });

  let widgetFactory:
    | ((
        tui: { requestRender: () => void },
        theme: { fg: (color: string, text: string) => string },
      ) => { render: (width: number) => string[]; invalidate: () => void; dispose: () => void })
    | undefined;
  const ctx = {
    cwd: "/repo",
    hasUI: true,
    ui: {
      setWidget: (_id: string, factory: typeof widgetFactory) => {
        widgetFactory = factory;
      },
    },
  } as unknown as NonNullable<typeof runtime.ctx>;

  updateIdeUi(runtime, ctx);
  if (!widgetFactory) assert.fail("widget factory was not registered");
  const widget = widgetFactory({ requestRender: () => undefined }, { fg: (_color, text) => text });
  const [line] = widget.render(106);

  assert.ok(line);
  assert.ok(visibleWidth(`${"한글".repeat(80)}.ts`) > 106);
  assert.ok(visibleWidth(line) <= 106, `${visibleWidth(line)} > 106`);

  setLatestSelection(runtime, {
    ...snapshot,
    filePath: `/repo/${"한글".repeat(80)}.ts`,
  });
  const [lineWithRange] = widget.render(106);

  assert.ok(lineWithRange);
  assert.ok(lineWithRange.includes("..."));
  assert.ok(lineWithRange.includes("#L10-L20"));
  assert.ok(lineWithRange.indexOf("...") < lineWithRange.indexOf("#L10-L20"));
  assert.ok(visibleWidth(lineWithRange) <= 106, `${visibleWidth(lineWithRange)} > 106`);
});

void test("resolves default lock directory under .pi subdirectory", () => {
  assert.equal(resolveLockDir(), resolve(homedir(), CONFIG_DIR_NAME, EXT_CONFIG_NAME, "lock"));
});

void test("loads environment overrides from pi config", async () => {
  const home = await mkdtemp(join(tmpdir(), "pi-x-ide-config-"));
  const configDir = join(home, CONFIG_DIR_NAME);
  const configPath = join(configDir, "config.json");
  await mkdir(configDir, { recursive: true });
  await writeFile(
    configPath,
    JSON.stringify({
      env: {
        PI_X_IDE_AUTO_INSTALL: "0",
        IGNORED_NULL: null,
      },
    }),
  );

  const configEnv = readPiConfigEnv(configPath);
  assert.equal(configEnv.PI_X_IDE_AUTO_INSTALL, "0");
  assert.equal(configEnv.IGNORED_NULL, undefined);

  const mergedEnv = resolvePiConfigEnv({ PI_X_IDE_AUTO_INSTALL: "1" }, { configPath });
  assert.equal(mergedEnv.PI_X_IDE_AUTO_INSTALL, "1");
});

void test("reads fix_prompt from pi config", async () => {
  const home = await mkdtemp(join(tmpdir(), "pi-x-ide-config-"));
  const configDir = join(home, CONFIG_DIR_NAME);
  const configPath = join(configDir, "config.json");
  await mkdir(configDir, { recursive: true });

  // Not set
  const absent = readPiConfigFixPrompt(configPath);
  assert.equal(absent, undefined);

  // With placeholder
  await writeFile(configPath, JSON.stringify({ fix_prompt: "Fix it: {DIAGNOSTIC}" }));
  const withPlaceholder = readPiConfigFixPrompt(configPath);
  assert.equal(withPlaceholder, "Fix it: {DIAGNOSTIC}");

  // Without placeholder
  await writeFile(configPath, JSON.stringify({ fix_prompt: "Just fix it." }));
  const withoutPlaceholder = readPiConfigFixPrompt(configPath);
  assert.equal(withoutPlaceholder, "Just fix it.");

  // Not a string
  await writeFile(configPath, JSON.stringify({ fix_prompt: 42 }));
  const notString = readPiConfigFixPrompt(configPath);
  assert.equal(notString, undefined);
});

void test("validates lock file content", () => {
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
  assert.deepEqual(parseLockFileContent(JSON.stringify({ ...lock, ide: "nvim", name: "Neovim" })), {
    ...lock,
    ide: "nvim",
    name: "Neovim",
  });
  assert.deepEqual(parseLockFileContent(JSON.stringify({ ...lock, ide: "jetbrains", name: "Pi x IDE" })), {
    ...lock,
    ide: "jetbrains",
    name: "Pi x IDE",
  });
  assert.equal(parseLockFileContent(JSON.stringify({ ...lock, ide: "helix" })), undefined);
  assert.equal(parseLockFileContent(JSON.stringify({ ...lock, port: 99999 })), undefined);
});

void test("accepts boolean runningInWindows and rejects non-boolean", () => {
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
  // Absent is valid (backward compatible with old lock files).
  assert.deepEqual(parseLockFileContent(JSON.stringify(lock)), lock);
  // Explicit true/false are preserved.
  assert.deepEqual(parseLockFileContent(JSON.stringify({ ...lock, runningInWindows: true })), {
    ...lock,
    runningInWindows: true,
  });
  assert.deepEqual(parseLockFileContent(JSON.stringify({ ...lock, runningInWindows: false })), {
    ...lock,
    runningInWindows: false,
  });
  // Non-boolean values are rejected.
  assert.equal(parseLockFileContent(JSON.stringify({ ...lock, runningInWindows: "true" })), undefined);
  assert.equal(parseLockFileContent(JSON.stringify({ ...lock, runningInWindows: 1 })), undefined);
  assert.equal(parseLockFileContent(JSON.stringify({ ...lock, runningInWindows: {} })), undefined);
});

void test("createIdeLockFile sets runningInWindows from override", () => {
  const base = {
    ide: "vscode" as const,
    name: "Visual Studio Code",
    port: 49152,
    authToken: "token",
    workspaceFolders: ["/repo"],
    pid: 4321,
    now: new Date("2026-06-21T00:00:00Z"),
  };
  assert.equal(createIdeLockFile({ ...base, runningInWindows: true }).runningInWindows, true);
  assert.equal(createIdeLockFile({ ...base, runningInWindows: false }).runningInWindows, false);
  // Falls back to the current platform when no override is provided.
  assert.equal(createIdeLockFile(base).runningInWindows, process.platform === "win32");
});

void test("validates jetbrains lock file content", () => {
  const lock: IdeLockFile = {
    version: 1,
    ide: "jetbrains",
    name: "Pi x IDE",
    transport: "ws",
    host: "127.0.0.1",
    port: 48123,
    authToken: "a".repeat(64),
    workspaceFolders: ["/repo"],
    pid: 12345,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  assert.deepEqual(parseLockFileContent(JSON.stringify(lock)), lock);
  // An unsupported JetBrains-adjacent source string is still rejected.
  assert.equal(parseLockFileContent(JSON.stringify({ ...lock, ide: "intellij" })), undefined);
});

void test("validates nvim editor selection snapshots", () => {
  assert.equal(isEditorSelectionSnapshot({ ...snapshot, source: "nvim" }), true);
  assert.equal(isEditorSelectionSnapshot({ ...snapshot, source: "helix" }), false);
});

void test("validates jetbrains editor selection snapshots", () => {
  // Non-empty ranges from a local file are accepted.
  assert.equal(isEditorSelectionSnapshot({ ...snapshot, source: "jetbrains" }), true);
  // An active file with no selection (empty ranges) is also a valid snapshot.
  assert.equal(
    isEditorSelectionSnapshot({
      source: "jetbrains",
      filePath: "/repo/src/main.ts",
      workspaceFolder: "/repo",
      ranges: [],
    }),
    true,
  );
  // An unsupported source string is still rejected.
  assert.equal(isEditorSelectionSnapshot({ ...snapshot, source: "intellij" }), false);
});

void test("matches workspace relationship", () => {
  assert.ok(relationshipMatchLength("/repo/src", "/repo/src/app") > relationshipMatchLength("/repo", "/repo/src/app"));
  assert.equal(relationshipMatchLength("/other", "/repo"), 0);
});

void test("normalizePathForHost converts Windows and UNC paths under WSL", () => {
  const wslEnv = { WSL_DISTRO_NAME: "Ubuntu" };
  // Drive-letter path -> /mnt mount.
  assert.equal(normalizePathForHost("C:\\Users\\me\\repo", wslEnv), "/mnt/c/Users/me/repo");
  assert.equal(normalizePathForHost("D:/work/repo/file.ts", wslEnv), "/mnt/d/work/repo/file.ts");
  // wsl$ and wsl.localhost UNC paths for the current distro -> Linux path.
  assert.equal(normalizePathForHost("\\\\wsl$\\Ubuntu\\home\\julian\\repo", wslEnv), "/home/julian/repo");
  assert.equal(normalizePathForHost("\\\\wsl.localhost\\Ubuntu\\home\\julian\\repo", wslEnv), "/home/julian/repo");
  // Forward-slash UNC paths (IntelliJ VirtualFile.getPath() is system-independent) -> Linux path.
  assert.equal(normalizePathForHost("//wsl.localhost/Ubuntu/home/julian/repo", wslEnv), "/home/julian/repo");
  assert.equal(normalizePathForHost("//wsl$/Ubuntu/home/julian/repo/src/a.ts", wslEnv), "/home/julian/repo/src/a.ts");
  // A UNC path for a different distro is left unchanged (both separator styles).
  assert.equal(
    normalizePathForHost("\\\\wsl.localhost\\Debian\\home\\julian\\repo", wslEnv),
    "\\\\wsl.localhost\\Debian\\home\\julian\\repo",
  );
  assert.equal(
    normalizePathForHost("//wsl.localhost/Debian/home/julian/repo", wslEnv),
    "//wsl.localhost/Debian/home/julian/repo",
  );
  // Outside WSL, paths are returned untouched.
  assert.equal(normalizePathForHost("C:\\Users\\me\\repo", {}), "C:\\Users\\me\\repo");
});

void test("normalizes editor selection snapshots for WSL host paths", () => {
  const raw: EditorSelectionSnapshot = {
    source: "jetbrains",
    filePath: "\\\\wsl.localhost\\Ubuntu\\home\\julian\\repo\\src\\a.ts",
    workspaceFolder: "\\\\wsl.localhost\\Ubuntu\\home\\julian\\repo",
    ranges: [
      {
        text: "hello",
        selection: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
      },
    ],
  };
  const normalized = normalizeEditorSelectionSnapshotForHost(raw, { WSL_DISTRO_NAME: "Ubuntu" });
  assert.equal(normalized.filePath, "/home/julian/repo/src/a.ts");
  assert.equal(normalized.workspaceFolder, "/home/julian/repo");
  assert.equal(formatRangeMention(normalized, { cwd: "/home/julian/repo" }), "@src/a.ts#L1");
  assert.match(formatEditorContext(normalized), /\/home\/julian\/repo\/src\/a\.ts/);

  const otherDistro = normalizeEditorSelectionSnapshotForHost(raw, { WSL_DISTRO_NAME: "Debian" });
  assert.equal(otherDistro.filePath, raw.filePath);
  assert.equal(otherDistro.workspaceFolder, raw.workspaceFolder);
});

void test("normalizes JetBrains-on-Windows forward-slash UNC snapshots for the Pi host", () => {
  // IntelliJ VirtualFile.getPath() is system-independent: Windows-side JetBrains
  // connected to a WSL project reports //wsl.localhost/<distro>/... with forward slashes.
  const raw: EditorSelectionSnapshot = {
    source: "jetbrains",
    filePath: "//wsl.localhost/Ubuntu/home/julian/repo/src/a.ts",
    workspaceFolder: "//wsl.localhost/Ubuntu/home/julian/repo",
    ranges: [
      {
        text: "hello",
        selection: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
      },
    ],
  };
  const normalized = normalizeEditorSelectionSnapshotForHost(raw, { WSL_DISTRO_NAME: "Ubuntu" });
  assert.equal(normalized.filePath, "/home/julian/repo/src/a.ts");
  assert.equal(normalized.workspaceFolder, "/home/julian/repo");
  assert.equal(formatRangeMention(normalized, { cwd: "/home/julian/repo" }), "@src/a.ts#L1");
  // The prompt context must reference the Linux path, never //wsl.localhost.
  const context = formatEditorContext(normalized);
  assert.match(context, /\/home\/julian\/repo\/src\/a\.ts/);
  assert.doesNotMatch(context, /wsl\.localhost/);
});

void test("isWsl detects WSL env markers without touching the host", () => {
  assert.equal(isWsl({ WSL_DISTRO_NAME: "Ubuntu" }), true);
  assert.equal(isWsl({ WSL_INTEROP: "/run/WSL/1_interop" }), true);
  assert.equal(isWsl({}), false);
});

void test("windowsUserProfileDirs returns empty outside WSL", () => {
  assert.deepEqual(windowsUserProfileDirs("/mnt/c/Users", {}), []);
});

void test("resolveLockDirs includes Windows user lock dirs under WSL", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-x-ide-users-"));
  const usersRoot = join(root, "Users");
  await mkdir(join(usersRoot, "julian"), { recursive: true });
  await mkdir(join(usersRoot, "Public"), { recursive: true });
  await mkdir(join(usersRoot, "Default User"), { recursive: true });
  const homeLockDir = join(root, "home-lock");

  assert.deepEqual(resolveLockDirs({ homeLockDir, windowsUsersRoot: usersRoot, env: { WSL_DISTRO_NAME: "Ubuntu" } }), [
    resolve(homeLockDir),
    resolve(usersRoot, "julian", CONFIG_DIR_NAME, EXT_CONFIG_NAME, "lock"),
  ]);
});

void test("resolveLockDirs lockDir override scans only the provided directory", () => {
  assert.deepEqual(
    resolveLockDirs({
      lockDir: "/tmp/custom-lock",
      homeLockDir: "/tmp/home-lock",
      windowsUsersRoot: "/mnt/c/Users",
      env: { WSL_DISTRO_NAME: "Ubuntu" },
    }),
    [resolve("/tmp/custom-lock")],
  );
});

void test("matches direct workspace paths for auto-connect", () => {
  assert.equal(hasDirectWorkspaceMatch(["/repo"], "/repo"), true);
  assert.equal(hasDirectWorkspaceMatch(["/repo"], "/repo/src/app"), true);
  assert.equal(hasDirectWorkspaceMatch(["/repo/src/app"], "/repo"), false);
  assert.equal(
    hasDirectWorkspaceMatch(["\\\\wsl.localhost\\Ubuntu\\home\\julian\\repo"], "/home/julian/repo", {
      WSL_DISTRO_NAME: "Ubuntu",
    }),
    true,
  );
  assert.ok(relationshipMatchLength("/repo/src/app", "/repo") > 0);
});

void test("discovers and sorts matching lock files", async () => {
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
  assert.equal(candidates[0].lock.port, 40001);

  // Invalid lockfile was removed during scanning
  await assert.rejects(() => access(join(dir, "bad.lock")));
});

void test("discovers candidates across home and WSL Windows lock directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-x-ide-multi-lock-"));
  const homeLockDir = join(root, "home-lock");
  const usersRoot = join(root, "Users");
  const windowsLockDir = join(usersRoot, "julian", CONFIG_DIR_NAME, EXT_CONFIG_NAME, "lock");
  await mkdir(homeLockDir, { recursive: true });
  await mkdir(windowsLockDir, { recursive: true });

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
  await writeFile(join(homeLockDir, "a.lock"), JSON.stringify(baseLock));
  await writeFile(
    join(windowsLockDir, "b.lock"),
    JSON.stringify({ ...baseLock, port: 40001, workspaceFolders: ["/repo/src"], runningInWindows: true }),
  );

  const candidates = await discoverIdeCandidates({
    cwd: "/repo/src/app",
    homeLockDir,
    windowsUsersRoot: usersRoot,
    env: { WSL_DISTRO_NAME: "Ubuntu" },
    checkPid: false,
  });
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].lock.port, 40001);
  assert.equal(candidates[1].lock.port, 40000);
});

void test("keeps Windows-side WSL lock when Linux PID check fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-x-ide-windows-pid-"));
  const homeLockDir = join(root, "home-lock");
  const usersRoot = join(root, "Users");
  const windowsLockDir = join(usersRoot, "julian", CONFIG_DIR_NAME, EXT_CONFIG_NAME, "lock");
  await mkdir(homeLockDir, { recursive: true });
  await mkdir(windowsLockDir, { recursive: true });
  const lockPath = join(windowsLockDir, "jetbrains-999999-48123.lock");
  const lock: IdeLockFile = {
    version: 1,
    ide: "jetbrains",
    name: "Pi x IDE JetBrains",
    transport: "ws",
    host: "127.0.0.1",
    port: 48123,
    authToken: "token",
    workspaceFolders: ["/repo"],
    pid: 999999,
    runningInWindows: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await writeFile(lockPath, JSON.stringify(lock));

  const candidates = await discoverIdeCandidates({
    cwd: "/repo",
    homeLockDir,
    windowsUsersRoot: usersRoot,
    env: { WSL_DISTRO_NAME: "Ubuntu" },
    resolveHost: () => Promise.resolve("172.30.96.1"),
    tcpProbe: (host, port) => Promise.resolve(host === "172.30.96.1" && port === 48123),
  });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].path, lockPath);
  await access(lockPath);
});

void test("removes unreachable Windows-side WSL lock after Linux PID check fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-x-ide-windows-pid-unreachable-"));
  const homeLockDir = join(root, "home-lock");
  const usersRoot = join(root, "Users");
  const windowsLockDir = join(usersRoot, "julian", CONFIG_DIR_NAME, EXT_CONFIG_NAME, "lock");
  await mkdir(homeLockDir, { recursive: true });
  await mkdir(windowsLockDir, { recursive: true });
  const lockPath = join(windowsLockDir, "jetbrains-999999-48124.lock");
  const lock: IdeLockFile = {
    version: 1,
    ide: "jetbrains",
    name: "Pi x IDE JetBrains",
    transport: "ws",
    host: "127.0.0.1",
    port: 48124,
    authToken: "token",
    workspaceFolders: ["/repo"],
    pid: 999999,
    runningInWindows: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await writeFile(lockPath, JSON.stringify(lock));

  const candidates = await discoverIdeCandidates({
    cwd: "/repo",
    homeLockDir,
    windowsUsersRoot: usersRoot,
    env: { WSL_DISTRO_NAME: "Ubuntu" },
    resolveHost: () => Promise.resolve("172.30.96.1"),
    tcpProbe: () => Promise.resolve(false),
  });
  assert.equal(candidates.length, 0);
  await assert.rejects(() => access(lockPath));
});
