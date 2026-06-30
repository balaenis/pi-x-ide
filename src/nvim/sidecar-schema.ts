import type { AtMentionedParams, EditorSelectionSnapshot, SelectionClearedParams } from "../shared/protocol.js";
import { isAtMentionedParams, isEditorSelectionSnapshot, isSelectionClearedParams } from "../shared/schema.js";

export interface SidecarConfig {
  workspaceFolders?: string[];
  name?: string;
  lockDir?: string;
}

export type NvimSidecarMessage =
  | { type: "selection_changed"; snapshot: EditorSelectionSnapshot }
  | { type: "selection_cleared"; reason?: SelectionClearedParams["reason"] }
  | { type: "at_mentioned"; snapshot: AtMentionedParams; rangeText?: string }
  | { type: "workspace_changed"; workspaceFolders: string[] }
  | { type: "shutdown" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function parseSidecarConfig(value: unknown): SidecarConfig | undefined {
  if (!isRecord(value)) return undefined;
  const workspaceFolders = value.workspaceFolders;
  const name = value.name;
  const lockDir = value.lockDir;
  if (workspaceFolders !== undefined && !isStringArray(workspaceFolders)) return undefined;
  if (name !== undefined && typeof name !== "string") return undefined;
  if (lockDir !== undefined && typeof lockDir !== "string") return undefined;
  return { workspaceFolders, name, lockDir };
}

export function parseNvimSidecarMessage(value: unknown): NvimSidecarMessage | undefined {
  if (!isRecord(value) || typeof value.type !== "string") return undefined;

  switch (value.type) {
    case "selection_changed":
      return isEditorSelectionSnapshot(value.snapshot)
        ? { type: "selection_changed", snapshot: value.snapshot }
        : undefined;
    case "selection_cleared": {
      const params = { source: "nvim", reason: value.reason ?? "no-active-editor" };
      return isSelectionClearedParams(params) ? { type: "selection_cleared", reason: params.reason } : undefined;
    }
    case "at_mentioned": {
      const snapshot = value.snapshot;
      if (!isAtMentionedParams(snapshot)) return undefined;
      const rangeText = typeof value.rangeText === "string" ? value.rangeText : snapshot.rangeText;
      return { type: "at_mentioned", snapshot, rangeText };
    }
    case "workspace_changed":
      return isStringArray(value.workspaceFolders)
        ? { type: "workspace_changed", workspaceFolders: value.workspaceFolders }
        : undefined;
    case "shutdown":
      return { type: "shutdown" };
    default:
      return undefined;
  }
}

export function parseJsonLine(line: string): unknown {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return undefined;
  }
}
