// ABOUTME: Provides shared error formatting and logging helpers for extension crash containment.
// ABOUTME: Keeps failures observable without rethrowing across process-level callback boundaries.

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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

export function logExtensionError(scope: string, error: unknown): void {
  const err = toError(error);
  console.error(`[pi-x-ide] ${scope}: ${err.message}`, err);
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
