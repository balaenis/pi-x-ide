// ABOUTME: Registers the pi-x-ide extension lifecycle, commands, and IDE connection callbacks.
// ABOUTME: Keeps the static shell Effect-free and loads heavy runtime services through one cached import.
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent" with {
  "resolution-mode": "import",
};
import { logExtensionError } from "../shared/errors.js";
import { registerIdeCommand } from "./commands.js";
import { registerContextHandlers } from "./context.js";
import { registerDiagnosticRenderer } from "./diagnostic-renderer.js";
import {
  loadRuntimeServices as defaultLoadRuntimeServices,
  preloadRuntimeServices as defaultPreloadRuntimeServices,
  type RuntimeServicesModule,
} from "./runtime-loader.js";
import {
  bindPiUiContext,
  containPiError,
  installPiErrorReporter,
  runPiBoundary,
  runPiBoundaryAsync,
} from "./safety.js";
import { createRuntime, type PiIdeRuntime } from "./state.js";
import { clearIdeUi } from "./ui.js";

export type RuntimeServicesLoader = {
  loadRuntimeServices: () => Promise<RuntimeServicesModule>;
  preloadRuntimeServices: () => Promise<RuntimeServicesModule>;
};

export type RegisterPiIdeExtensionOptions = {
  /**
   * Test-only loader overrides. Production callers must omit this so the
   * cached dynamic import of runtime-services is used.
   */
  runtimeLoader?: RuntimeServicesLoader;
};

export default function (pi: ExtensionAPI): void {
  registerPiIdeExtension(pi);
}

/** Register the extension; optional loader injection is for tests only. */
export function registerPiIdeExtension(pi: ExtensionAPI, options: RegisterPiIdeExtensionOptions = {}): PiIdeRuntime {
  const runtime = createRuntime();
  const loadRuntimeServices = options.runtimeLoader?.loadRuntimeServices ?? defaultLoadRuntimeServices;
  const preloadRuntimeServices = options.runtimeLoader?.preloadRuntimeServices ?? defaultPreloadRuntimeServices;

  // Route contained failures through pi ui.notify instead of console.error.
  installPiErrorReporter(runtime);

  registerContextHandlers(pi, runtime);
  registerDiagnosticRenderer(pi);
  registerIdeCommand(pi, runtime, {
    refreshCandidates: (ctx) =>
      withRuntimeServices(loadRuntimeServices, runtime, ctx, (services) => services.refreshCandidates(runtime, ctx)),
    connectAuto: (ctx) =>
      withRuntimeServices(loadRuntimeServices, runtime, ctx, (services) => services.connectAuto(runtime, ctx, pi)),
    connectCandidate: (candidate, ctx) =>
      withRuntimeServices(loadRuntimeServices, runtime, ctx, (services) =>
        services.connectCandidate(runtime, candidate, ctx, {}, pi),
      ),
    disconnect: (ctx, disabled) =>
      withRuntimeServices(loadRuntimeServices, runtime, ctx, (services) => services.disconnect(runtime, ctx, disabled)),
    installExtension: (ctx) =>
      withRuntimeServices(loadRuntimeServices, runtime, ctx, (services) => services.installExtension(runtime, ctx)),
  });

  // Start the heavy runtime import during factory execution but do not await it.
  void preloadRuntimeServices().catch((error) => {
    logExtensionError("Pi runtime preload", error);
  });

  pi.on("session_start", (_event, ctx) =>
    runPiBoundary(
      "Pi session start",
      runtime,
      () => {
        // Session startup begins here (not at factory preload).
        runtime.sessionGeneration += 1;
        const generation = runtime.sessionGeneration;
        // Bind UI first so deferred preload failures can notify once.
        bindPiUiContext(runtime, ctx);
        runtime.cwd = ctx.cwd;
        runtime.sessionStarting = true;

        // Pi awaits every session_start handler before its own init finishes, and IDE
        // discovery/connect can take seconds on WSL mounts. Keep the handler immediate:
        // the heavy work runs in the background and shutdown still awaits startupTask.
        const startupTask = (async () => {
          try {
            const services = await loadRuntimeServices();
            if (runtime.sessionGeneration !== generation) return;
            await services.startSession(pi, runtime, ctx);
          } catch (error) {
            // No outer session_start boundary anymore: the handler already returned.
            // Report through the same scope name so failures keep surfacing as session-start errors.
            containPiError(runtime, "Pi session start", error, ctx);
          } finally {
            // A newer session_start always bumps the generation, so this single guard is
            // enough to avoid clearing a successor task.
            if (runtime.sessionGeneration === generation) {
              runtime.startupTask = undefined;
              runtime.sessionStarting = false;
            }
          }
        })();
        runtime.startupTask = startupTask;
      },
      ctx,
    ),
  );

  pi.on("session_shutdown", (_event, ctx) =>
    runPiBoundaryAsync(
      "Pi session shutdown",
      runtime,
      async () => {
        // Bump generation before any await so delayed startups observe staleness.
        runtime.sessionGeneration += 1;
        runtime.sessionStarting = false;
        bindPiUiContext(runtime, ctx);

        const pendingStartup = runtime.startupTask;
        if (pendingStartup) {
          await pendingStartup.catch(() => undefined);
        }

        const shouldLoadRuntime =
          !!runtime.connection || !!runtime.reconnectFiber || !!runtime.zedPollFiber || !!pendingStartup;

        if (shouldLoadRuntime) {
          try {
            const services = await loadRuntimeServices();
            await services.shutdownSession(runtime, ctx);
            return;
          } catch (error) {
            logExtensionError("Pi session shutdown runtime load", error);
          }
        }

        // Lightweight cleanup when the heavy module never became necessary.
        const connection = runtime.connection;
        runtime.connection = undefined;
        connection?.disconnect();
        clearIdeUi(runtime, ctx);
        runtime.ctx = undefined;
      },
      ctx,
    ),
  );

  return runtime;
}

async function withRuntimeServices<T>(
  loadRuntimeServices: () => Promise<RuntimeServicesModule>,
  runtime: PiIdeRuntime,
  ctx: ExtensionContext | ExtensionCommandContext,
  action: (services: RuntimeServicesModule) => Promise<T>,
): Promise<T> {
  const services = await loadRuntimeServices();
  bindPiUiContext(runtime, ctx);
  return action(services);
}
