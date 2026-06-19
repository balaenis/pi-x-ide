// ABOUTME: Builds VS Code diagnostic quick fixes that send problem context to Pi.
// ABOUTME: Normalizes diagnostics into the pi-x-ide protocol with bounded text payloads.
import * as vscode from "vscode";
import type {
  DiagnosticContextLine,
  DiagnosticFixRequestedParams,
  IdeDiagnostic,
  IdeDiagnosticCode,
  IdeDiagnosticRelatedInformation,
  Position,
} from "../../src/shared/protocol";
import { errorMessage, logExtensionError, safeRun } from "../../src/shared/errors";
import type { IdeWebSocketServer } from "./server";

export const FIX_WITH_PI_COMMAND = "pi-x-ide.fixWithPiSuggest";
export const FIX_WITH_PI_TITLE = "Pi: Fix it";
export const SEND_DIAGNOSTIC_COMMAND = "pi-x-ide.sendDiagnostic";
export const SEND_DIAGNOSTIC_TITLE = "Pi: Send diagnostic";
export const DIAGNOSTIC_CONTEXT_RADIUS = 2;
export const MAX_SELECTED_TEXT_CHARS = 4_000;

export function registerDiagnosticQuickFixes(
  context: vscode.ExtensionContext,
  getServer: () => IdeWebSocketServer | undefined,
): void {
  const provider = new PiDiagnosticCodeActionProvider(getServer);
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider({ scheme: "file" }, provider, {
      providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
    }),
    vscode.commands.registerCommand(FIX_WITH_PI_COMMAND, (payload: DiagnosticFixRequestedParams) =>
      runDiagnosticCommand(FIX_WITH_PI_TITLE, () =>
        sendDiagnosticRequest(getServer(), { ...payload, action: "fix" }, FIX_WITH_PI_TITLE),
      ),
    ),
    vscode.commands.registerCommand(SEND_DIAGNOSTIC_COMMAND, (payload: DiagnosticFixRequestedParams) =>
      runDiagnosticCommand(SEND_DIAGNOSTIC_TITLE, () =>
        sendDiagnosticRequest(getServer(), { ...payload, action: "send-diagnostic" }, SEND_DIAGNOSTIC_TITLE),
      ),
    ),
  );
}

function runDiagnosticCommand(title: string, action: () => void): void {
  safeRun(`VS Code diagnostic command ${title}`, action, (error) => {
    logExtensionError(`VS Code diagnostic command ${title}`, error);
    void vscode.window.showWarningMessage(`Pi x IDE: ${title} failed: ${errorMessage(error)}`);
  });
}

class PiDiagnosticCodeActionProvider implements vscode.CodeActionProvider<vscode.CodeAction> {
  constructor(private readonly getServer: () => IdeWebSocketServer | undefined) {}

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    return (
      safeRun("VS Code diagnostic code actions", () => {
        if (context.only && !context.only.contains(vscode.CodeActionKind.QuickFix)) return [];
        if (document.uri.scheme !== "file") return [];
        if (!this.hasConnectedPiClient()) return [];

        const diagnostics = context.diagnostics.filter(isFixableDiagnostic);
        if (diagnostics.length === 0) return [];

        const payload = createDiagnosticFixPayload(document, range, diagnostics);
        return [
          createDiagnosticAction(FIX_WITH_PI_TITLE, FIX_WITH_PI_COMMAND, payload, diagnostics),
          createDiagnosticAction(SEND_DIAGNOSTIC_TITLE, SEND_DIAGNOSTIC_COMMAND, payload, diagnostics),
        ];
      }, (error) => {
        logExtensionError("VS Code diagnostic code actions", error);
      }) ?? []
    );
  }

  private hasConnectedPiClient(): boolean {
    return (this.getServer()?.clientCount ?? 0) > 0;
  }
}

function sendDiagnosticRequest(
  server: IdeWebSocketServer | undefined,
  payload: DiagnosticFixRequestedParams,
  title: string,
): void {
  if (!server) {
    void vscode.window.showWarningMessage(`Pi x IDE: diagnostic server is not ready for ${title}.`);
    return;
  }

  const sent = server.sendToFirstClient({
    jsonrpc: "2.0",
    method: "diagnostic_fix_requested",
    params: payload,
  });

  if (!sent) {
    void vscode.window.showWarningMessage(`Pi x IDE: no Pi clients connected for ${title}.`);
  } else {
    vscode.window.setStatusBarMessage(`Pi x IDE sent ${title}`, 2500);
  }
}

function createDiagnosticAction(
  title: string,
  command: string,
  payload: DiagnosticFixRequestedParams,
  diagnostics: vscode.Diagnostic[],
): vscode.CodeAction {
  const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
  action.diagnostics = diagnostics;
  action.command = {
    command,
    title,
    arguments: [payload],
  };
  return action;
}

function createDiagnosticFixPayload(
  document: vscode.TextDocument,
  triggerRange: vscode.Range | vscode.Selection,
  diagnostics: vscode.Diagnostic[],
): DiagnosticFixRequestedParams {
  return {
    source: "vscode",
    filePath: document.uri.fsPath,
    workspaceFolder: vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath,
    documentVersion: document.version,
    triggerRange: toProtocolRange(triggerRange),
    diagnostics: diagnostics.map((diagnostic) => normalizeDiagnostic(document, diagnostic)),
    receivedAt: Date.now(),
  };
}

function normalizeDiagnostic(document: vscode.TextDocument, diagnostic: vscode.Diagnostic): IdeDiagnostic {
  return {
    severity: diagnostic.severity === vscode.DiagnosticSeverity.Error ? "error" : "warning",
    message: diagnostic.message,
    source: diagnostic.source,
    code: normalizeDiagnosticCode(diagnostic.code),
    range: toProtocolRange(diagnostic.range),
    selectedText: truncateSelectedText(document.getText(diagnostic.range)),
    contextLines: getContextLines(document, diagnostic.range),
    relatedInformation: normalizeRelatedInformation(diagnostic.relatedInformation),
  };
}

function isFixableDiagnostic(diagnostic: vscode.Diagnostic): boolean {
  return (
    diagnostic.severity === vscode.DiagnosticSeverity.Error || diagnostic.severity === vscode.DiagnosticSeverity.Warning
  );
}

function toProtocolRange(range: vscode.Range): { start: Position; end: Position } {
  return {
    start: toProtocolPosition(range.start),
    end: toProtocolPosition(range.end),
  };
}

function toProtocolPosition(position: vscode.Position): Position {
  return { line: position.line, character: position.character };
}

function normalizeDiagnosticCode(code: vscode.Diagnostic["code"]): IdeDiagnosticCode | undefined {
  if (code === undefined) return undefined;
  if (typeof code === "string" || typeof code === "number") return code;
  return {
    value: code.value,
    target: code.target?.toString(),
  };
}

function truncateSelectedText(text: string): string {
  if (text.length <= MAX_SELECTED_TEXT_CHARS) return text;
  return `${text.slice(0, MAX_SELECTED_TEXT_CHARS)}\n...[truncated]`;
}

function getContextLines(document: vscode.TextDocument, range: vscode.Range): DiagnosticContextLine[] {
  const startLine = Math.max(0, range.start.line - DIAGNOSTIC_CONTEXT_RADIUS);
  const endLine = Math.min(document.lineCount - 1, range.end.line + DIAGNOSTIC_CONTEXT_RADIUS);
  const lines: DiagnosticContextLine[] = [];
  for (let line = startLine; line <= endLine; line += 1) {
    lines.push({
      line,
      text: document.lineAt(line).text,
      isPrimary: line >= range.start.line && line <= range.end.line,
    });
  }
  return lines;
}

function normalizeRelatedInformation(
  relatedInformation: readonly vscode.DiagnosticRelatedInformation[] | undefined,
): IdeDiagnosticRelatedInformation[] | undefined {
  if (!relatedInformation || relatedInformation.length === 0) return undefined;
  return relatedInformation.map((related) => ({
    filePath: related.location.uri.scheme === "file" ? related.location.uri.fsPath : related.location.uri.toString(),
    range: toProtocolRange(related.location.range),
    message: related.message,
  }));
}
