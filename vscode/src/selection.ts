import * as vscode from "vscode";
import type { EditorSelectionSnapshot, SelectionRange } from "../../src/shared/protocol";
import type { RangeFormat } from "../../src/shared/format";
import { formatRangeMention } from "../../src/shared/format";

let cachedSelectionSnapshot: EditorSelectionSnapshot | undefined;

export function getConfiguredRangeFormat(): RangeFormat {
  const value = vscode.workspace.getConfiguration("piXIde").get<string>("rangeFormat", "comma");
  return value === "dash" ? "dash" : "comma";
}

export function getActiveSelectionSnapshot(): EditorSelectionSnapshot | undefined {
  const snapshot = createSelectionSnapshot(vscode.window.activeTextEditor);
  if (snapshot) {
    cachedSelectionSnapshot = snapshot;
    return snapshot;
  }

  if (shouldUseCachedSelectionSnapshot()) {
    return cachedSelectionSnapshot;
  }

  cachedSelectionSnapshot = undefined;
  return undefined;
}

function createSelectionSnapshot(editor: vscode.TextEditor | undefined): EditorSelectionSnapshot | undefined {
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

function shouldUseCachedSelectionSnapshot(): boolean {
  if (!cachedSelectionSnapshot) return false;
  if (!isActiveTerminalEditorTab()) return false;
  return isSnapshotOpenInTab(cachedSelectionSnapshot);
}

function isActiveTerminalEditorTab(): boolean {
  const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
  return activeTab?.input instanceof vscode.TabInputTerminal;
}

function isSnapshotOpenInTab(snapshot: EditorSelectionSnapshot): boolean {
  return vscode.window.tabGroups.all.some((group) =>
    group.tabs.some((tab) => tabInputContainsFilePath(tab.input, snapshot.filePath)),
  );
}

function tabInputContainsFilePath(input: vscode.Tab["input"], filePath: string): boolean {
  if (
    input instanceof vscode.TabInputText ||
    input instanceof vscode.TabInputCustom ||
    input instanceof vscode.TabInputNotebook
  ) {
    return uriMatchesFilePath(input.uri, filePath);
  }

  if (input instanceof vscode.TabInputTextDiff || input instanceof vscode.TabInputNotebookDiff) {
    return uriMatchesFilePath(input.original, filePath) || uriMatchesFilePath(input.modified, filePath);
  }

  return false;
}

function uriMatchesFilePath(uri: vscode.Uri, filePath: string): boolean {
  return uri.scheme === "file" && uri.fsPath === filePath;
}

export function getActiveRangeMention(): string | undefined {
  const snapshot = getActiveSelectionSnapshot();
  if (!snapshot) return undefined;
  return formatRangeMention(snapshot, { format: getConfiguredRangeFormat() });
}
