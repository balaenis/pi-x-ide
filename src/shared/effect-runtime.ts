// ABOUTME: Runs Effect programs at Pi and IDE process boundaries.
// ABOUTME: Converts failures into logged outcomes without rethrowing into hosts.
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { logExtensionError } from "./errors.js";

function reportBoundaryFailure(scope: string, error: unknown, onError?: (error: unknown) => void): void {
  if (onError) onError(error);
  else logExtensionError(scope, error);
}

/** Map Exit failures to a single unknown via Cause.squash (tagged errors + defects). */
function failureFromCause(cause: Cause.Cause<unknown>): unknown {
  return Cause.squash(cause);
}

export async function runEffect<A>(
  scope: string,
  effect: Effect.Effect<A, unknown, never>,
  onError?: (error: unknown) => void,
): Promise<A | undefined> {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) {
    return exit.value;
  }
  reportBoundaryFailure(scope, failureFromCause(exit.cause), onError);
  return undefined;
}

/**
 * Run a synchronous Effect at a process boundary.
 * Async effects fail the Exit (AsyncFiberException) and are logged/swallowed like other failures.
 */
export function runEffectSync<A>(
  scope: string,
  effect: Effect.Effect<A, unknown, never>,
  onError?: (error: unknown) => void,
): A | undefined {
  const exit = Effect.runSyncExit(effect);
  if (Exit.isSuccess(exit)) {
    return exit.value;
  }
  reportBoundaryFailure(scope, failureFromCause(exit.cause), onError);
  return undefined;
}

/** Test / internal only — does not swallow; rethrows Cause.squash result (preserves tagged errors). */
export async function runEffectOrThrow<A>(effect: Effect.Effect<A, unknown, never>): Promise<A> {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) {
    return exit.value;
  }
  throw failureFromCause(exit.cause);
}
