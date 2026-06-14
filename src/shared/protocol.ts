export const PROTOCOL_VERSION = 1;
export const AUTH_HEADER = "x-pi-x-ide-authorization";
export const LOCK_FILE_EXTENSION = ".lock";

export type IdeSource = "vscode" | "zed" | "nvim" | "unknown";
export type Transport = "ws";

export interface IdeLockFile {
  version: 1;
  ide: IdeSource;
  name: string;
  transport: Transport;
  host: string;
  port: number;
  authToken: string;
  workspaceFolders: string[];
  pid?: number;
  createdAt: string;
  updatedAt: string;
}

export interface LockFileCandidate {
  path: string;
  lock: IdeLockFile;
  mtimeMs: number;
  matchLength: number;
  workspaceFolder: string;
}

export interface JsonRpcRequest<TParams = unknown> {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: TParams;
}

export interface JsonRpcResponse<TResult = unknown> {
  jsonrpc: "2.0";
  id: number | string;
  result?: TResult;
  error?: { code: number; message: string };
}

export interface JsonRpcNotification<TParams = unknown> {
  jsonrpc: "2.0";
  method: string;
  params?: TParams;
}

export interface InitializeParams {
  protocolVersion: number;
  client: {
    name: "pi-x-ide";
    version: string;
  };
  cwd: string;
}

export interface InitializeResult {
  protocolVersion: number;
  server: {
    name: string;
    version?: string;
    ide: IdeSource;
  };
}

export interface Position {
  line: number;
  character: number;
}

export interface SelectionRange {
  text: string;
  selection: {
    start: Position;
    end: Position;
  };
}

export interface EditorSelectionSnapshot {
  source: IdeSource;
  filePath: string;
  workspaceFolder?: string;
  ranges: SelectionRange[];
  receivedAt?: number;
}

export interface SelectionChangedParams extends EditorSelectionSnapshot {}

export interface SelectionClearedParams {
  source: IdeSource;
  reason: "no-active-editor";
  receivedAt?: number;
}

export interface AtMentionedParams extends EditorSelectionSnapshot {
  rangeText: string;
}

export type IdeDiagnosticSeverity = "error" | "warning";

export type IdeDiagnosticCode = string | number | { value: string | number; target?: string };

export interface DiagnosticContextLine {
  line: number;
  text: string;
  isPrimary: boolean;
}

export interface IdeDiagnosticRelatedInformation {
  filePath: string;
  range: {
    start: Position;
    end: Position;
  };
  message: string;
}

export interface IdeDiagnostic {
  severity: IdeDiagnosticSeverity;
  message: string;
  source?: string;
  code?: IdeDiagnosticCode;
  range: {
    start: Position;
    end: Position;
  };
  selectedText: string;
  contextLines: DiagnosticContextLine[];
  relatedInformation?: IdeDiagnosticRelatedInformation[];
}

export type DiagnosticRequestAction = "fix" | "send-diagnostic";

export interface DiagnosticFixRequestedParams {
  action?: DiagnosticRequestAction;
  source: "vscode";
  filePath: string;
  workspaceFolder?: string;
  documentVersion?: number;
  triggerRange: {
    start: Position;
    end: Position;
  };
  diagnostics: IdeDiagnostic[];
  receivedAt?: number;
}

export type IdeNotification =
  | JsonRpcNotification<SelectionChangedParams>
  | JsonRpcNotification<SelectionClearedParams>
  | JsonRpcNotification<AtMentionedParams>
  | JsonRpcNotification<DiagnosticFixRequestedParams>;

export type AttachState = "pending" | "sent" | "idle";
