// ABOUTME: Provides shared error formatting and reporting helpers for extension crash containment.
// ABOUTME: Routes failures through a host reporter (pi notify) without dumping stacks to console.

export type ExtensionErrorReporter = (scope: string, error: unknown) => void;

let extensionErrorReporter: ExtensionErrorReporter | undefined;

/** Install the host-side sink for contained extension failures (e.g. pi `ui.notify`). */
export function setExtensionErrorReporter(reporter: ExtensionErrorReporter | undefined): void {
  extensionErrorReporter = reporter;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Matches pi runner assertActive / invalidate sentinel text. */
export function isStaleContextError(error: unknown): boolean {
  return errorMessage(error).includes("stale after session replacement or reload");
}

export function toError(error: unknown, prefix?: string): Error {
  if (error instanceof Error) {
    if (!prefix) return error;
    return new Error(`${prefix}: ${error.message}`, { cause: error });
  }
  return new Error(prefix ? `${prefix}: ${String(error)}` : String(error));
}

/** Stable user-facing message used by pi notify and tests. */
export function formatExtensionError(scope: string, error: unknown): string {
  return `[pi-x-ide] ${scope}: ${errorMessage(error)}`;
}

/**
 * Report a contained extension failure through the host reporter.
 * Does not write to console — hosts must install a reporter (pi uses ui.notify).
 */
export function logExtensionError(scope: string, error: unknown): void {
  extensionErrorReporter?.(scope, error);
}

export function safeRun<T>(scope: string, action: () => T, onError?: (error: unknown) => void): T | undefined {
  try {
    return action();
  } catch (error) {
    if (onError) onError(error);
    else logExtensionError(scope, error);
    return undefined;
  }
}

export async function safeRunAsync<T>(
  scope: string,
  action: () => Promise<T>,
  onError?: (error: unknown) => void,
): Promise<T | undefined> {
  try {
    return await action();
  } catch (error) {
    if (onError) onError(error);
    else logExtensionError(scope, error);
    return undefined;
  }
}
