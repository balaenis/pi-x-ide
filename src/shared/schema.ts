import type {
  AtMentionedParams,
  EditorSelectionSnapshot,
  IdeLockFile,
  IdeSource,
  JsonRpcRequest,
  SelectionChangedParams,
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
  return value === "vscode" || value === "zed" || value === "unknown";
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
    isString(value.createdAt) &&
    isString(value.updatedAt)
  );
}

function isPosition(value: unknown): value is { line: number; character: number } {
  return isRecord(value) && isFiniteNumber(value.line) && isFiniteNumber(value.character) && value.line >= 0 && value.character >= 0;
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

export function isAtMentionedParams(value: unknown): value is AtMentionedParams {
  return isEditorSelectionSnapshot(value) && isString((value as unknown as Record<string, unknown>).rangeText);
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
  return isRecord(value) && value.jsonrpc === "2.0" && (isString(value.id) || isFiniteNumber(value.id)) && isString(value.method);
}
