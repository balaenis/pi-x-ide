// ABOUTME: Contains Pi-side error boundaries that keep pi-x-ide failures inside the extension.
// ABOUTME: Logs callback failures, updates runtime error state, and avoids rethrowing into Pi.
import type { ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent" with {
  "resolution-mode": "import",
};
import { errorMessage, logExtensionError, safeRun, safeRunAsync } from "../shared/errors";
import type { PiIdeRuntime } from "./state";
import { updateIdeUi } from "./ui";

export function containPiError(
  runtime: PiIdeRuntime,
  scope: string,
  error: unknown,
  ctx: ExtensionContext | ExtensionCommandContext | undefined = runtime.ctx,
): void {
  logExtensionError(scope, error);
  runtime.connectionStatus = "error";
  runtime.connectionMessage = `${scope}: ${errorMessage(error)}`;
  safeRun(`${scope} update UI after error`, () => updateIdeUi(runtime, ctx));
}

export function runPiBoundary<T>(
  scope: string,
  runtime: PiIdeRuntime,
  action: () => T,
  ctx?: ExtensionContext | ExtensionCommandContext,
): T | undefined {
  return safeRun(scope, action, (error) => containPiError(runtime, scope, error, ctx));
}

export async function runPiBoundaryAsync<T>(
  scope: string,
  runtime: PiIdeRuntime,
  action: () => Promise<T>,
  ctx?: ExtensionContext | ExtensionCommandContext,
): Promise<T | undefined> {
  return safeRunAsync(scope, action, (error) => containPiError(runtime, scope, error, ctx));
}
