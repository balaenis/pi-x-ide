// ABOUTME: Defines Effect Schema validators for shared Pi x IDE protocol payloads.
// ABOUTME: Provides decode helpers used by schema.ts adapters without changing on-wire shapes.
import * as Either from "effect/Either";
import * as Schema from "effect/Schema";
import type {
  AtMentionedParams,
  DiagnosticFixRequestedParams,
  EditorSelectionSnapshot,
  IdeLockFile,
  JsonRpcRequest,
  SelectionChangedParams,
  SelectionClearedParams,
} from "./protocol.js";

const FiniteNumber = Schema.Number.pipe(Schema.finite());
const NonNegativeFinite = FiniteNumber.pipe(Schema.greaterThanOrEqualTo(0));
const PortNumber = FiniteNumber.pipe(Schema.greaterThan(0), Schema.lessThanOrEqualTo(65_535));

export const PositionSchema = Schema.Struct({
  line: NonNegativeFinite,
  character: NonNegativeFinite,
});

export const SelectionRangeSchema = Schema.Struct({
  text: Schema.String,
  selection: Schema.Struct({
    start: PositionSchema,
    end: PositionSchema,
  }),
});

export const IdeSourceSchema = Schema.Literal("vscode", "zed", "nvim", "jetbrains", "unknown");

export const IdeLockFileSchema = Schema.Struct({
  version: Schema.Literal(1),
  ide: IdeSourceSchema,
  name: Schema.String,
  transport: Schema.Literal("ws"),
  host: Schema.String,
  port: PortNumber,
  authToken: Schema.String,
  workspaceFolders: Schema.mutable(Schema.Array(Schema.String)),
  pid: Schema.optional(FiniteNumber),
  runningInWindows: Schema.optional(Schema.Boolean),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

export const EditorSelectionSnapshotSchema = Schema.Struct({
  source: IdeSourceSchema,
  filePath: Schema.String,
  workspaceFolder: Schema.optional(Schema.String),
  ranges: Schema.mutable(Schema.Array(SelectionRangeSchema)),
  receivedAt: Schema.optional(FiniteNumber),
});

export const SelectionChangedParamsSchema = EditorSelectionSnapshotSchema;

export const SelectionClearedParamsSchema = Schema.Struct({
  source: IdeSourceSchema,
  reason: Schema.Literal("no-active-editor"),
  receivedAt: Schema.optional(FiniteNumber),
});

export const AtMentionedParamsSchema = Schema.Struct({
  source: IdeSourceSchema,
  filePath: Schema.String,
  workspaceFolder: Schema.optional(Schema.String),
  ranges: Schema.mutable(Schema.Array(SelectionRangeSchema)),
  receivedAt: Schema.optional(FiniteNumber),
  rangeText: Schema.String,
});

const IdeDiagnosticCodeSchema = Schema.Union(
  Schema.String,
  FiniteNumber,
  Schema.Struct({
    value: Schema.Union(Schema.String, FiniteNumber),
    target: Schema.optional(Schema.String),
  }),
);

const DiagnosticContextLineSchema = Schema.Struct({
  line: NonNegativeFinite,
  text: Schema.String,
  isPrimary: Schema.Boolean,
});

const RangeSchema = Schema.Struct({
  start: PositionSchema,
  end: PositionSchema,
});

const IdeDiagnosticRelatedInformationSchema = Schema.Struct({
  filePath: Schema.String,
  range: RangeSchema,
  message: Schema.String,
});

export const IdeDiagnosticSchema = Schema.Struct({
  severity: Schema.Literal("error", "warning"),
  message: Schema.String,
  source: Schema.optional(Schema.String),
  code: Schema.optional(IdeDiagnosticCodeSchema),
  range: RangeSchema,
  selectedText: Schema.String,
  contextLines: Schema.mutable(Schema.Array(DiagnosticContextLineSchema)),
  relatedInformation: Schema.optional(Schema.mutable(Schema.Array(IdeDiagnosticRelatedInformationSchema))),
});

export const DiagnosticFixRequestedParamsSchema = Schema.Struct({
  action: Schema.optional(Schema.Literal("fix", "send-diagnostic")),
  source: Schema.Literal("vscode"),
  filePath: Schema.String,
  workspaceFolder: Schema.optional(Schema.String),
  documentVersion: Schema.optional(FiniteNumber),
  triggerRange: RangeSchema,
  diagnostics: Schema.mutable(Schema.Array(IdeDiagnosticSchema)).pipe(Schema.minItems(1)),
  receivedAt: Schema.optional(FiniteNumber),
});

export const JsonRpcRequestSchema = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  id: Schema.Union(Schema.String, FiniteNumber),
  method: Schema.String,
});

function decodeUnknown<A, I>(schema: Schema.Schema<A, I, never>, input: unknown): A | undefined {
  const result = Schema.decodeUnknownEither(schema)(input);
  return Either.isRight(result) ? result.right : undefined;
}

export function decodeLockFile(input: unknown): IdeLockFile | undefined {
  return decodeUnknown(IdeLockFileSchema, input);
}

export function decodeEditorSelectionSnapshot(input: unknown): EditorSelectionSnapshot | undefined {
  return decodeUnknown(EditorSelectionSnapshotSchema, input);
}

export function decodeSelectionChangedParams(input: unknown): SelectionChangedParams | undefined {
  return decodeEditorSelectionSnapshot(input);
}

export function decodeSelectionClearedParams(input: unknown): SelectionClearedParams | undefined {
  return decodeUnknown(SelectionClearedParamsSchema, input);
}

export function decodeAtMentionedParams(input: unknown): AtMentionedParams | undefined {
  return decodeUnknown(AtMentionedParamsSchema, input);
}

export function decodeDiagnosticFixRequestedParams(input: unknown): DiagnosticFixRequestedParams | undefined {
  return decodeUnknown(DiagnosticFixRequestedParamsSchema, input);
}

export function decodeJsonRpcRequest(input: unknown): JsonRpcRequest | undefined {
  return decodeUnknown(JsonRpcRequestSchema, input);
}
