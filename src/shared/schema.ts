// ABOUTME: Validates shared Pi x IDE JSON payloads at runtime.
// ABOUTME: Guards lock files, editor snapshots, diagnostics, and JSON-RPC messages from malformed data.
import type {
  AtMentionedParams,
  DiagnosticFixRequestedParams,
  IdeDiagnostic,
  IdeDiagnosticCode,
  IdeDiagnosticRelatedInformation,
  DiagnosticContextLine,
  EditorSelectionSnapshot,
  IdeLockFile,
  IdeSource,
  JsonRpcRequest,
  Position,
  SelectionChangedParams,
  SelectionClearedParams,
  SelectionRange,
} from "./protocol";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isIdeSource(value: unknown): value is IdeSource {
  return value === "vscode" || value === "zed" || value === "nvim" || value === "jetbrains" || value === "unknown";
}

export function isIdeLockFile(value: unknown): value is IdeLockFile {
  if (!isRecord(value)) return false;
  return (
    value.version === 1 &&
    isIdeSource(value.ide) &&
    isString(value.name) &&
    value.transport === "ws" &&
    isString(value.host) &&
    isFiniteNumber(value.port) &&
    value.port > 0 &&
    value.port <= 65_535 &&
    isString(value.authToken) &&
    Array.isArray(value.workspaceFolders) &&
    value.workspaceFolders.every(isString) &&
    (value.pid === undefined || isFiniteNumber(value.pid)) &&
    (value.runningInWindows === undefined || typeof value.runningInWindows === "boolean") &&
    isString(value.createdAt) &&
    isString(value.updatedAt)
  );
}

function isPosition(value: unknown): value is { line: number; character: number } {
  return (
    isRecord(value) &&
    isFiniteNumber(value.line) &&
    isFiniteNumber(value.character) &&
    value.line >= 0 &&
    value.character >= 0
  );
}

function isRange(value: unknown): value is { start: Position; end: Position } {
  return isRecord(value) && isPosition(value.start) && isPosition(value.end);
}

function isSelectionRange(value: unknown): value is SelectionRange {
  if (!isRecord(value) || !isString(value.text) || !isRecord(value.selection)) return false;
  return isPosition(value.selection.start) && isPosition(value.selection.end);
}

export function isEditorSelectionSnapshot(value: unknown): value is EditorSelectionSnapshot {
  if (!isRecord(value)) return false;
  return (
    isIdeSource(value.source) &&
    isString(value.filePath) &&
    (value.workspaceFolder === undefined || isString(value.workspaceFolder)) &&
    Array.isArray(value.ranges) &&
    value.ranges.every(isSelectionRange) &&
    (value.receivedAt === undefined || isFiniteNumber(value.receivedAt))
  );
}

export function isSelectionChangedParams(value: unknown): value is SelectionChangedParams {
  return isEditorSelectionSnapshot(value);
}

export function isSelectionClearedParams(value: unknown): value is SelectionClearedParams {
  return (
    isRecord(value) &&
    isIdeSource(value.source) &&
    value.reason === "no-active-editor" &&
    (value.receivedAt === undefined || isFiniteNumber(value.receivedAt))
  );
}

export function isAtMentionedParams(value: unknown): value is AtMentionedParams {
  return isEditorSelectionSnapshot(value) && isString((value as unknown as Record<string, unknown>).rangeText);
}

function isDiagnosticSeverity(value: unknown): value is IdeDiagnostic["severity"] {
  return value === "error" || value === "warning";
}

function isDiagnosticCode(value: unknown): value is IdeDiagnosticCode {
  if (isString(value) || isFiniteNumber(value)) return true;
  return (
    isRecord(value) &&
    (isString(value.value) || isFiniteNumber(value.value)) &&
    (value.target === undefined || isString(value.target))
  );
}

function isDiagnosticContextLine(value: unknown): value is DiagnosticContextLine {
  return (
    isRecord(value) &&
    isFiniteNumber(value.line) &&
    value.line >= 0 &&
    isString(value.text) &&
    typeof value.isPrimary === "boolean"
  );
}

function isDiagnosticRelatedInformation(value: unknown): value is IdeDiagnosticRelatedInformation {
  return isRecord(value) && isString(value.filePath) && isRange(value.range) && isString(value.message);
}

function isIdeDiagnostic(value: unknown): value is IdeDiagnostic {
  return (
    isRecord(value) &&
    isDiagnosticSeverity(value.severity) &&
    isString(value.message) &&
    (value.source === undefined || isString(value.source)) &&
    (value.code === undefined || isDiagnosticCode(value.code)) &&
    isRange(value.range) &&
    isString(value.selectedText) &&
    Array.isArray(value.contextLines) &&
    value.contextLines.every(isDiagnosticContextLine) &&
    (value.relatedInformation === undefined ||
      (Array.isArray(value.relatedInformation) && value.relatedInformation.every(isDiagnosticRelatedInformation)))
  );
}

function isDiagnosticRequestAction(value: unknown): boolean {
  return value === "fix" || value === "send-diagnostic";
}

export function isDiagnosticFixRequestedParams(value: unknown): value is DiagnosticFixRequestedParams {
  return (
    isRecord(value) &&
    (value.action === undefined || isDiagnosticRequestAction(value.action)) &&
    value.source === "vscode" &&
    isString(value.filePath) &&
    (value.workspaceFolder === undefined || isString(value.workspaceFolder)) &&
    (value.documentVersion === undefined || isFiniteNumber(value.documentVersion)) &&
    isRange(value.triggerRange) &&
    Array.isArray(value.diagnostics) &&
    value.diagnostics.length > 0 &&
    value.diagnostics.every(isIdeDiagnostic) &&
    (value.receivedAt === undefined || isFiniteNumber(value.receivedAt))
  );
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
  return isIdeLockFile(parsed) ? parsed : undefined;
}

export function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  return (
    isRecord(value) &&
    value.jsonrpc === "2.0" &&
    (isString(value.id) || isFiniteNumber(value.id)) &&
    isString(value.method)
  );
}
