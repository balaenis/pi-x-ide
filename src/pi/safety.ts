// ABOUTME: Contains Pi-side error boundaries that keep pi-x-ide failures inside the extension.
// ABOUTME: Reports via pi ui.notify, updates runtime error state, and avoids rethrowing into Pi.
import type { ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent" with {
  "resolution-mode": "import",
};
import {
  errorMessage,
  formatExtensionError,
  isStaleContextError,
  logExtensionError,
  safeRun,
  safeRunAsync,
  setExtensionErrorReporter,
} from "../shared/errors.js";
import type { PiIdeRuntime } from "./state.js";
import { updateIdeUi } from "./ui.js";

type PiUiContext = ExtensionContext | ExtensionCommandContext;

/** Try to deliver through pi ui.notify. Returns false when UI is unavailable. */
function deliverPiError(scope: string, error: unknown, ctx: PiUiContext | undefined): boolean {
  try {
    if (!ctx?.hasUI) return false;
    ctx.ui.notify(formatExtensionError(scope, error), "error");
    return true;
  } catch {
    // Stale or unavailable UI — caller may queue for a later context.
    return false;
  }
}

/** Deliver a failure through pi's standard UI notify path when available. */
export function notifyPiError(scope: string, error: unknown, ctx: PiUiContext | undefined): void {
  if (isStaleContextError(error)) return;
  deliverPiError(scope, error, ctx);
}

/**
 * Flush errors that were deferred until a Pi UI context existed.
 * Re-queues any item that still cannot be delivered.
 */
export function flushPendingPiErrors(runtime: PiIdeRuntime): void {
  if (runtime.pendingExtensionErrors.length === 0) return;

  const pending = runtime.pendingExtensionErrors;
  runtime.pendingExtensionErrors = [];
  for (const item of pending) {
    if (isStaleContextError(item.error)) continue;
    if (!deliverPiError(item.scope, item.error, runtime.ctx)) {
      runtime.pendingExtensionErrors.push(item);
    }
  }
}

/** Bind the active Pi UI context and deliver any deferred extension errors. */
export function bindPiUiContext(runtime: PiIdeRuntime, ctx: PiUiContext): void {
  runtime.ctx = ctx;
  flushPendingPiErrors(runtime);
}

/**
 * Report via the runtime's current ctx, or queue until bindPiUiContext runs.
 * Stale context errors are dropped (never queued).
 */
function reportPiExtensionError(runtime: PiIdeRuntime, scope: string, error: unknown): void {
  if (isStaleContextError(error)) return;
  if (deliverPiError(scope, error, runtime.ctx)) return;
  runtime.pendingExtensionErrors.push({ scope, error });
}

/**
 * Install the process-wide extension error reporter that routes through pi notify.
 * Call once when the extension factory registers so logExtensionError never hits console.
 * Pending errors stay on the given runtime (not a process-global buffer).
 */
export function installPiErrorReporter(runtime: PiIdeRuntime): void {
  setExtensionErrorReporter((scope, error) => {
    reportPiExtensionError(runtime, scope, error);
  });
}

export function containPiError(
  runtime: PiIdeRuntime,
  scope: string,
  error: unknown,
  ctx: PiUiContext | undefined = runtime.ctx,
): void {
  if (ctx) bindPiUiContext(runtime, ctx);
  logExtensionError(scope, error);
  runtime.connectionStatus = "error";
  runtime.connectionMessage = `${scope}: ${errorMessage(error)}`;
  safeRun(`${scope} update UI after error`, () => updateIdeUi(runtime, ctx ?? runtime.ctx));
}

export function runPiBoundary<T>(
  scope: string,
  runtime: PiIdeRuntime,
  action: () => T,
  ctx?: PiUiContext,
): T | undefined {
  return safeRun(scope, action, (error) => containPiError(runtime, scope, error, ctx));
}

export async function runPiBoundaryAsync<T>(
  scope: string,
  runtime: PiIdeRuntime,
  action: () => Promise<T>,
  ctx?: PiUiContext,
): Promise<T | undefined> {
  return safeRunAsync(scope, action, (error) => containPiError(runtime, scope, error, ctx));
}
