// ABOUTME: Tracks per-candidate IDE reconnect attempt counters and limit messages.
// ABOUTME: Keeps reconnect policy pure so scheduling can use timers or Effect fibers.
import type { LockFileCandidate } from "../shared/protocol.js";
import type { PiIdeRuntime } from "./state.js";

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

function reconnectCandidateKey(candidate: LockFileCandidate): string {
  return `${candidate.path}:${candidate.lock.host}:${candidate.lock.port}:${candidate.mtimeMs}`;
}
