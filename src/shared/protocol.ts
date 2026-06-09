export const PROTOCOL_VERSION = 1;
export const LOCK_DIR_ENV = "PI_X_IDE_LOCK_DIR";
export const AUTH_HEADER = "x-pi-x-ide-authorization";
export const LOCK_FILE_EXTENSION = ".lock";

export type IdeSource = "vscode" | "zed" | "unknown";
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

export interface AtMentionedParams extends EditorSelectionSnapshot {
  rangeText: string;
}

export type IdeNotification =
  | JsonRpcNotification<SelectionChangedParams>
  | JsonRpcNotification<AtMentionedParams>;

export type AttachState = "pending" | "sent" | "idle";
