import * as vscode from "vscode";
import type { EditorSelectionSnapshot, SelectionRange } from "../../src/shared/protocol";
import type { RangeFormat } from "../../src/shared/format";
import { formatRangeMention } from "../../src/shared/format";

export function getConfiguredRangeFormat(): RangeFormat {
  const value = vscode.workspace.getConfiguration("piXIde").get<string>("rangeFormat", "comma");
  return value === "dash" ? "dash" : "comma";
}

export function getActiveSelectionSnapshot(): EditorSelectionSnapshot | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return undefined;
  const document = editor.document;
  if (document.uri.scheme !== "file") return undefined;

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath;
  const ranges: SelectionRange[] = editor.selections
    .filter((selection) => !selection.isEmpty)
    .map((selection) => ({
      text: document.getText(selection),
      selection: {
        start: { line: selection.start.line, character: selection.start.character },
        end: { line: selection.end.line, character: selection.end.character },
      },
    }));

  return {
    source: "vscode",
    filePath: document.uri.fsPath,
    workspaceFolder,
    ranges,
  };
}

export function getActiveRangeMention(): string | undefined {
  const snapshot = getActiveSelectionSnapshot();
  if (!snapshot) return undefined;
  return formatRangeMention(snapshot, { format: getConfiguredRangeFormat() });
}
