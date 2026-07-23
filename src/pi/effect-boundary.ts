// ABOUTME: Runs Effect programs at Pi session/command boundaries with contained failures.
// ABOUTME: Keeps Effect runtime imports out of the lightweight safety helpers shell.
import type { ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent" with {
  "resolution-mode": "import",
};
import type { Effect } from "effect/Effect";
import { runEffect } from "../shared/effect-runtime.js";
import { containPiError } from "./safety.js";
import type { PiIdeRuntime } from "./state.js";

/** Run an Effect at a Pi session/command boundary; failures update runtime error status. */
export function runPiEffect<A>(
  scope: string,
  runtime: PiIdeRuntime,
  effect: Effect<A, unknown, never>,
  ctx?: ExtensionContext | ExtensionCommandContext,
): Promise<A | undefined> {
  return runEffect(scope, effect, (error) => containPiError(runtime, scope, error, ctx));
}
