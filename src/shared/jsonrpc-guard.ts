// ABOUTME: Provides a lightweight JSON-RPC request type guard for IDE host bundles.
// ABOUTME: Stays free of Effect so VS Code can import ide-server without Schema runtime cost.
import type { JsonRpcRequest } from "./protocol.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Hand-rolled guard kept Effect-free for the VS Code / IDE host import graph. */
export function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  return (
    isRecord(value) &&
    value.jsonrpc === "2.0" &&
    (typeof value.id === "string" || isFiniteNumber(value.id)) &&
    typeof value.method === "string"
  );
}
