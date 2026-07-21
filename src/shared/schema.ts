// ABOUTME: Validates shared Pi x IDE JSON payloads at runtime.
// ABOUTME: Guards lock files, editor snapshots, diagnostics, and JSON-RPC messages from malformed data.
import type {
  AtMentionedParams,
  DiagnosticFixRequestedParams,
  EditorSelectionSnapshot,
  IdeLockFile,
  SelectionChangedParams,
  SelectionClearedParams,
} from "./protocol.js";
import {
  decodeAtMentionedParams,
  decodeDiagnosticFixRequestedParams,
  decodeEditorSelectionSnapshot,
  decodeLockFile,
  decodeSelectionChangedParams,
  decodeSelectionClearedParams,
} from "./effect-schema.js";
import { isJsonRpcRequest } from "./jsonrpc-guard.js";

export { isJsonRpcRequest };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isIdeLockFile(value: unknown): value is IdeLockFile {
  return decodeLockFile(value) !== undefined;
}

export function isEditorSelectionSnapshot(value: unknown): value is EditorSelectionSnapshot {
  return decodeEditorSelectionSnapshot(value) !== undefined;
}

export function isSelectionChangedParams(value: unknown): value is SelectionChangedParams {
  return decodeSelectionChangedParams(value) !== undefined;
}

export function isSelectionClearedParams(value: unknown): value is SelectionClearedParams {
  return decodeSelectionClearedParams(value) !== undefined;
}

export function isAtMentionedParams(value: unknown): value is AtMentionedParams {
  return decodeAtMentionedParams(value) !== undefined;
}

export function isDiagnosticFixRequestedParams(value: unknown): value is DiagnosticFixRequestedParams {
  return decodeDiagnosticFixRequestedParams(value) !== undefined;
}

export function parseJsonObject(input: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(input) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function parseLockFileContent(content: string): IdeLockFile | undefined {
  const parsed = parseJsonObject(content);
  return parsed === undefined ? undefined : decodeLockFile(parsed);
}
