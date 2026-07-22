// ABOUTME: Covers the lightweight Pi extension shell, cached runtime loader, and lifecycle races.
// ABOUTME: Ensures commands register before heavy runtime settles and shutdown cancels stale starts.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent" with {
  "resolution-mode": "import",
};
import { registerPiIdeExtension } from "../src/pi/index.js";
import { createRuntimeServicesLoaderForTests, type RuntimeServicesModule } from "../src/pi/runtime-loader.js";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
// Compiled tests live in dist/test; safety.js is emitted next to other Pi modules.
const SAFETY_JS_PATH = join(TEST_DIR, "../src/pi/safety.js");

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

function createExtensionContext(cwd: string): ExtensionContext {
  return {
    cwd,
    hasUI: true,
    ui: {
      notify: () => {},
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
