// ABOUTME: Covers the lightweight Pi extension shell, cached runtime loader, and lifecycle races.
// ABOUTME: Ensures commands register before heavy runtime settles and shutdown cancels stale starts.
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent" with {
  "resolution-mode": "import",
};
import { registerPiIdeExtension } from "../src/pi/index.js";
import { createRuntimeServicesLoaderForTests, type RuntimeServicesModule } from "../src/pi/runtime-loader.js";
import { formatExtensionError } from "../src/shared/errors.js";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
// Compiled tests live in dist/test; safety.js is emitted next to other Pi modules.
const SAFETY_JS_PATH = join(TEST_DIR, "../src/pi/safety.js");
const PI_ENTRY_JS_PATH = join(TEST_DIR, "../src/pi/index.js");
const PI_CHUNKS_DIR = join(TEST_DIR, "../src/pi/chunks");
const COMMANDS_SOURCE_PATH = join(TEST_DIR, "../../src/pi/commands.ts");
const HOST_PACKAGE_RUNTIME_IMPORT_RE =
  /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)["']@earendil-works\/(?:pi-coding-agent|pi-tui)(?:\/[^"']*)?["']/;

void test("compiled safety.js stays Effect-free", async () => {
  const source = await readFile(SAFETY_JS_PATH, "utf8");
  assert.doesNotMatch(source, /from ["']effect(?:\/[^"']*)?["']/);
  assert.doesNotMatch(source, /effect-runtime/);
  assert.doesNotMatch(source, /runPiEffect/);
});

void test("runtime loader caches one promise and clears cache after failure", async () => {
  let calls = 0;
  const loader = createRuntimeServicesLoaderForTests(() => {
    calls += 1;
    if (calls === 1) {
      return Promise.reject(new Error("boom-import"));
    }
    return Promise.resolve(createFakeRuntimeServices());
  });

  await assert.rejects(() => loader.loadRuntimeServices(), /boom-import/);
  assert.equal(calls, 1);

  const first = loader.loadRuntimeServices();
  const second = loader.loadRuntimeServices();
  assert.equal(first, second);
  await first;
  assert.equal(calls, 2);
});

void test("factory registers commands before runtime-services settles", async () => {
  let resolveModule!: (module: RuntimeServicesModule) => void;
  const pending = new Promise<RuntimeServicesModule>((resolve) => {
    resolveModule = resolve;
  });
  const loader = {
    loadRuntimeServices: () => pending,
    preloadRuntimeServices: () => pending,
  };

  const fake = createFakeExtensionApi();
  registerPiIdeExtension(fake.api, { runtimeLoader: loader });

  assert.ok(fake.commands.has("ide"), "expected /ide command registration before runtime settles");
  assert.ok(fake.sessionStart, "expected session_start registration before runtime settles");
  assert.ok(fake.sessionShutdown, "expected session_shutdown registration before runtime settles");
  assert.ok(fake.rendererCount > 0, "expected diagnostic renderer registration");

  resolveModule(createFakeRuntimeServices());
  await pending;
});

void test("commands.ts keeps config-ui behind a dynamic import boundary", async () => {
  const source = await readFile(COMMANDS_SOURCE_PATH, "utf8");
  assert.doesNotMatch(source, /import\s*\{[^}]*showIdeSettings[^}]*\}\s*from\s*["']\.\/config-ui\.js["']/);
  assert.match(source, /await\s+import\(\s*["']\.\/config-ui\.js["']\s*\)/);
});

void test("bundled Pi entry outputs have no host-package runtime imports", async () => {
  const entrySource = await readFile(PI_ENTRY_JS_PATH, "utf8");
  assert.doesNotMatch(entrySource, HOST_PACKAGE_RUNTIME_IMPORT_RE);
  // Settings / pi-tui must not be a static edge from the shell.
  assert.doesNotMatch(entrySource, /from\s*["'][^"']*config-ui[^"']*["']/);
  assert.doesNotMatch(entrySource, /@earendil-works\/pi-tui/);

  const chunkNames = (await readdir(PI_CHUNKS_DIR)).filter((name) => name.endsWith(".js"));
  assert.ok(chunkNames.length > 0, "expected esbuild to emit lazy Pi entry chunks");

  for (const name of chunkNames) {
    const chunkSource = await readFile(join(PI_CHUNKS_DIR, name), "utf8");
    assert.doesNotMatch(
      chunkSource,
      HOST_PACKAGE_RUNTIME_IMPORT_RE,
      `chunk ${name} must not externalize Pi host packages`,
    );
  }
});

void test("session_start bumps generation before load and calls startSession once", async () => {
  const calls: Array<{ generation: number; cwd: string }> = [];
  let resolveModule!: (module: RuntimeServicesModule) => void;
  const pending = new Promise<RuntimeServicesModule>((resolve) => {
    resolveModule = resolve;
  });
  const loader = {
    loadRuntimeServices: () => pending,
    preloadRuntimeServices: () => pending,
  };

  const fake = createFakeExtensionApi();
  const runtime = registerPiIdeExtension(fake.api, { runtimeLoader: loader });
  const ctx = createExtensionContext("/repo");
  const startPromise = Promise.resolve(fake.sessionStart?.({}, ctx));

  assert.equal(runtime.sessionGeneration, 1);
  assert.equal(runtime.sessionStarting, true);
  assert.equal(calls.length, 0);

  resolveModule(
    createFakeRuntimeServices({
      startSession: (_pi, sessionRuntime, sessionCtx) => {
        calls.push({ generation: sessionRuntime.sessionGeneration, cwd: sessionCtx.cwd });
        return Promise.resolve();
      },
    }),
  );

  await startPromise;
  assert.deepEqual(calls, [{ generation: 1, cwd: "/repo" }]);
  assert.equal(runtime.sessionStarting, false);
});

void test("session_start resolves while auto-install task remains pending", async () => {
  let resolveInstall!: () => void;
  const installPending = new Promise<void>((resolve) => {
    resolveInstall = resolve;
  });
  let installStarted = false;

  const services = createFakeRuntimeServices({
    startSession: () => {
      installStarted = true;
      // Fire-and-forget auto-install must not gate session_start completion.
      void installPending;
      return Promise.resolve();
    },
  });
  const loader = {
    loadRuntimeServices: () => Promise.resolve(services),
    preloadRuntimeServices: () => Promise.resolve(services),
  };

  const fake = createFakeExtensionApi();
  registerPiIdeExtension(fake.api, { runtimeLoader: loader });

  const started = Date.now();
  await fake.sessionStart?.({}, createExtensionContext("/repo"));
  const elapsed = Date.now() - started;

  assert.equal(installStarted, true);
  assert.ok(elapsed < 250, `session_start waited too long (${elapsed}ms)`);
  resolveInstall();
});

void test("session_shutdown bumps generation before awaiting delayed startup and blocks reconnect", async () => {
  let resolveModule!: (module: RuntimeServicesModule) => void;
  const pending = new Promise<RuntimeServicesModule>((resolve) => {
    resolveModule = resolve;
  });
  const events: string[] = [];
  const loader = {
    loadRuntimeServices: () => pending,
    preloadRuntimeServices: () => pending,
  };

  const fake = createFakeExtensionApi();
  const runtime = registerPiIdeExtension(fake.api, { runtimeLoader: loader });

  const startPromise = Promise.resolve(fake.sessionStart?.({}, createExtensionContext("/repo")));
  assert.equal(runtime.sessionGeneration, 1);

  const shutdownPromise = Promise.resolve(fake.sessionShutdown?.({}, createExtensionContext("/repo")));
  assert.equal(runtime.sessionGeneration, 2);
  assert.equal(runtime.sessionStarting, false);

  resolveModule(
    createFakeRuntimeServices({
      startSession: (_pi, sessionRuntime) => {
        events.push(`start:${sessionRuntime.sessionGeneration}`);
        return Promise.resolve();
      },
      shutdownSession: (sessionRuntime) => {
        events.push(`shutdown:${sessionRuntime.sessionGeneration}`);
        return Promise.resolve();
      },
    }),
  );

  await Promise.all([startPromise, shutdownPromise]);
  assert.ok(events.includes("shutdown:2"));
  assert.ok(!events.includes("start:1"), "stale generation-1 start must not run after shutdown");
});

void test("/ide disconnect awaits async action including pending preload", async () => {
  let resolveModule!: (module: RuntimeServicesModule) => void;
  const pending = new Promise<RuntimeServicesModule>((resolve) => {
    resolveModule = resolve;
  });
  let disconnectResolved = false;
  const loader = {
    loadRuntimeServices: () => pending,
    preloadRuntimeServices: () => pending,
  };

  const fake = createFakeExtensionApi();
  registerPiIdeExtension(fake.api, { runtimeLoader: loader });

  const command = fake.commands.get("ide");
  assert.ok(command);

  const handlerPromise = command.handler("off", createCommandContext("/repo")).then(() => {
    disconnectResolved = true;
  });

  await Promise.resolve();
  assert.equal(disconnectResolved, false);

  resolveModule(createFakeRuntimeServices());
  await handlerPromise;
  assert.equal(disconnectResolved, true);
});

void test("registerPiIdeExtension routes session boundary failures through pi ui.notify", async () => {
  const notifications: Array<{ message: string; type?: string }> = [];
  const services = createFakeRuntimeServices({
    startSession: () => Promise.reject(new Error("start-boom")),
  });
  const loader = {
    loadRuntimeServices: () => Promise.resolve(services),
    preloadRuntimeServices: () => Promise.resolve(services),
  };

  const fake = createFakeExtensionApi();
  const runtime = registerPiIdeExtension(fake.api, { runtimeLoader: loader });

  // Must go through the bundled session boundary: external logExtensionError imports
  // a different module instance than the esbuild Pi entry embeds.
  await fake.sessionStart?.({}, createExtensionContext("/repo", notifications));

  assert.equal(runtime.connectionStatus, "error");
  assert.match(runtime.connectionMessage ?? "", /start-boom/);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0]?.type, "error");
  assert.equal(notifications[0]?.message, formatExtensionError("Pi session start", new Error("start-boom")));
  assert.equal(runtime.pendingExtensionErrors.length, 0);
});

void test("preload failure notifies once session_start provides UI context", async () => {
  const notifications: Array<{ message: string; type?: string }> = [];
  let rejectPreload!: (error: Error) => void;
  const preloadFailure = new Promise<RuntimeServicesModule>((_resolve, reject) => {
    rejectPreload = reject;
  });
  // Prevent unhandled rejection noise from the test-controlled reject.
  preloadFailure.catch(() => undefined);

  const services = createFakeRuntimeServices();
  const loader = {
    loadRuntimeServices: () => Promise.resolve(services),
    preloadRuntimeServices: () => preloadFailure,
  };

  const fake = createFakeExtensionApi();
  const runtime = registerPiIdeExtension(fake.api, { runtimeLoader: loader });

  rejectPreload(new Error("preload-boom"));
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(notifications.length, 0, "no UI context yet — must not notify");
  assert.equal(runtime.pendingExtensionErrors.length, 1);
  assert.equal(runtime.pendingExtensionErrors[0]?.scope, "Pi runtime preload");

  await fake.sessionStart?.({}, createExtensionContext("/repo", notifications));

  assert.equal(runtime.pendingExtensionErrors.length, 0);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0]?.type, "error");
  assert.equal(notifications[0]?.message, formatExtensionError("Pi runtime preload", new Error("preload-boom")));
});

function createFakeRuntimeServices(overrides: Partial<RuntimeServicesModule> = {}): RuntimeServicesModule {
  return {
    startSession: () => Promise.resolve(),
    shutdownSession: () => Promise.resolve(),
    refreshCandidates: () => Promise.resolve([]),
    connectAuto: () => Promise.resolve(),
    connectCandidate: () => Promise.resolve(),
    disconnect: () => Promise.resolve(),
    installExtension: () => Promise.resolve(),
    ...overrides,
  };
}

function createFakeExtensionApi(): {
  api: ExtensionAPI;
  commands: Map<string, { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }>;
  sessionStart?: (event: unknown, ctx: ExtensionContext) => Promise<void> | void;
  sessionShutdown?: (event: unknown, ctx: ExtensionContext) => Promise<void> | void;
  rendererCount: number;
} {
  const commands = new Map<string, { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }>();
  let sessionStart: ((event: unknown, ctx: ExtensionContext) => Promise<void> | void) | undefined;
  let sessionShutdown: ((event: unknown, ctx: ExtensionContext) => Promise<void> | void) | undefined;
  let rendererCount = 0;

  const api = {
    registerCommand: (
      name: string,
      command: { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> },
    ) => {
      commands.set(name, command);
    },
    registerShortcut: () => {},
    registerMessageRenderer: () => {
      rendererCount += 1;
    },
    on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => Promise<void> | void) => {
      if (event === "session_start") sessionStart = handler;
      if (event === "session_shutdown") sessionShutdown = handler;
    },
    sendMessage: () => {},
    appendEntry: () => {},
  } as unknown as ExtensionAPI;

  return {
    api,
    commands,
    get sessionStart() {
      return sessionStart;
    },
    get sessionShutdown() {
      return sessionShutdown;
    },
    get rendererCount() {
      return rendererCount;
    },
  };
}

function createExtensionContext(
  cwd: string,
  notifications?: Array<{ message: string; type?: string }>,
): ExtensionContext {
  return {
    cwd,
    hasUI: true,
    ui: {
      notify: (message: string, type?: string) => {
        notifications?.push({ message, type });
      },
      setWidget: () => {},
      setStatus: () => {},
      pasteToEditor: () => {},
      select: () => Promise.resolve(undefined),
    },
  } as unknown as ExtensionContext;
}

function createCommandContext(cwd: string): ExtensionCommandContext {
  return createExtensionContext(cwd) as unknown as ExtensionCommandContext;
}
