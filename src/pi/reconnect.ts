// ABOUTME: Tracks per-candidate IDE reconnect attempt counters and limit messages.
// ABOUTME: Schedules interruptible reconnect fibers while keeping policy counters pure.
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import type { LockFileCandidate } from "../shared/protocol.js";
import type { PiIdeRuntime } from "./state.js";
import { updateIdeUi } from "./ui.js";

export const MAX_RECONNECT_ATTEMPTS = 3;
export const RECONNECT_DELAY_MS = 2_000;

export function resetReconnectState(runtime: PiIdeRuntime): void {
  runtime.reconnectAttempts = 0;
  runtime.reconnectCandidateKey = undefined;
}

export function recordReconnectAttempt(
  runtime: PiIdeRuntime,
  candidate: LockFileCandidate | undefined,
): number | undefined {
  const key = candidate ? reconnectCandidateKey(candidate) : undefined;
  if (runtime.reconnectCandidateKey !== key) {
    runtime.reconnectCandidateKey = key;
    runtime.reconnectAttempts = 0;
  }

  if (runtime.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) return undefined;
  runtime.reconnectAttempts += 1;
  return runtime.reconnectAttempts;
}

export function formatReconnectLimitMessage(candidate: LockFileCandidate | undefined): string {
  const target = candidate ? `${candidate.lock.name} at ${candidate.lock.host}:${candidate.lock.port}` : "IDE";
  return `Stopped reconnecting to ${target} after ${MAX_RECONNECT_ATTEMPTS} attempts.`;
}

export function stopReconnectScheduling(runtime: PiIdeRuntime): void {
  const fiber = runtime.reconnectFiber;
  runtime.reconnectFiber = undefined;
  if (fiber) Effect.runFork(Fiber.interrupt(fiber));
}

/**
 * Schedule a reconnect after RECONNECT_DELAY_MS.
 * `reconnect` receives the generation captured at schedule time for guard checks.
 */
export function scheduleReconnect(
  runtime: PiIdeRuntime,
  reconnect: (generation: number) => Promise<void>,
): void {
  if (runtime.reconnectFiber || !runtime.enabled) return;
  const generation = runtime.sessionGeneration;
  const attempt = recordReconnectAttempt(runtime, runtime.currentCandidate);
  if (attempt === undefined) {
    runtime.connectionStatus = "error";
    runtime.connectionMessage = formatReconnectLimitMessage(runtime.currentCandidate);
    updateIdeUi(runtime);
    return;
  }

  const fiber = Effect.runFork(
    Effect.gen(function* () {
      yield* Effect.sleep(`${RECONNECT_DELAY_MS} millis`);
      // Clear handle at fire (main timer parity) before connect work so another
      // schedule can be accepted during discovery/connect.
      if (runtime.reconnectFiber === fiber) runtime.reconnectFiber = undefined;
      if (!runtime.enabled || runtime.sessionGeneration !== generation) return;
      yield* Effect.promise(() => reconnect(generation));
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (runtime.reconnectFiber === fiber) runtime.reconnectFiber = undefined;
        }),
      ),
    ),
  );
  runtime.reconnectFiber = fiber;
}

function reconnectCandidateKey(candidate: LockFileCandidate): string {
  return `${candidate.path}:${candidate.lock.host}:${candidate.lock.port}:${candidate.mtimeMs}`;
}
