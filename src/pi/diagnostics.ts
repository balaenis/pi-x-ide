// ABOUTME: Handles VS Code diagnostic-fix requests from the IDE by forwarding them to Pi.
// ABOUTME: Builds the LLM fix prompt and renders the request as a custom message in the TUI.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent" with { "resolution-mode": "import" };
import { readPiConfigFixPrompt } from "../shared/config.js";

import { DIAGNOSTIC_FIX_CUSTOM_TYPE, type DiagnosticFixDetails } from "./diagnostic-renderer.js";
import type { DiagnosticFixRequestedParams, IdeDiagnosticCode, Position } from "../shared/protocol.js";
import type { PiIdeRuntime } from "./state.js";

export const DIAGNOSTIC_CONTEXT_MARKER = "pi-x-ide/diagnostic-context";

export function buildDiagnosticFixPrompt(
  params: DiagnosticFixRequestedParams,
  options: { fixPrompt?: string } = {},
): string {
  const context = buildDiagnosticContextMessage(params);
  const template = options.fixPrompt;
  if (!template) {
    return `Analyze the errors and warnings at the following location, and try to fix them:
${context}`;
  }
  if (template.includes("{DIAGNOSTIC}")) {
    return template.replaceAll("{DIAGNOSTIC}", context);
  }
  return `${template}
${context}`;
}

export function buildDiagnosticContextMessage(params: DiagnosticFixRequestedParams): string {
  return `<!-- ${DIAGNOSTIC_CONTEXT_MARKER} -->
${formatDiagnosticContext(params)}
<!-- ${DIAGNOSTIC_CONTEXT_MARKER} -->
`;
}

export function formatDiagnosticContext(params: DiagnosticFixRequestedParams): string {
  const filePath = params.filePath;
  const lines = [`File: ${filePath}`, `Source: ${params.source}`];
  if (params.documentVersion !== undefined) lines.push(`Document version: ${params.documentVersion}`);
  lines.push(`Trigger range: ${formatRange(params.triggerRange)}`);

  for (const [index, diagnostic] of params.diagnostics.entries()) {
    lines.push("", `Diagnostic ${index + 1}:`);
    lines.push(`- Severity: ${diagnostic.severity}`);
    if (diagnostic.source) lines.push(`- Source: ${diagnostic.source}`);
    if (diagnostic.code !== undefined) lines.push(`- Code: ${formatDiagnosticCode(diagnostic.code)}`);
    lines.push(`- Range: ${formatRange(diagnostic.range)}`);
    lines.push(`- Message: ${diagnostic.message}`);

    if (diagnostic.selectedText.length > 0) {
      lines.push("- Selected text:", fence(diagnostic.selectedText));
    }

    if (diagnostic.contextLines.length > 0) {
      lines.push("- Context lines:");
      for (const contextLine of diagnostic.contextLines) {
        const marker = contextLine.isPrimary ? "\\>" : " ";
        lines.push(`  ${marker} ${contextLine.line + 1}: ${contextLine.text}`);
      }
    }

    if (diagnostic.relatedInformation && diagnostic.relatedInformation.length > 0) {
      lines.push("- Related information:");
      for (const related of diagnostic.relatedInformation) {
        const relatedPath = related.filePath;
        lines.push(`  - ${relatedPath} ${formatRange(related.range)}: ${related.message}`);
      }
    }
  }

  return lines.join("\n");
}

export function handleDiagnosticFixRequested(
  pi: ExtensionAPI,
  runtime: PiIdeRuntime,
  params: DiagnosticFixRequestedParams,
): void {
  const ctx = runtime.ctx;
  if (!ctx) return;

  if (params.action === "send-diagnostic") {
    if (!ctx.hasUI) return;
    ctx.ui.pasteToEditor(buildDiagnosticContextMessage(params));
    ctx.ui.notify("VS Code diagnostic context added to input.", "info");
    return;
  }

  const fixPrompt = readPiConfigFixPrompt();
  const prompt = buildDiagnosticFixPrompt(params, { fixPrompt });
  const details: DiagnosticFixDetails = {
    source: params.source,
    filePath: params.filePath,
    workspaceFolder: params.workspaceFolder,
    triggerRange: params.triggerRange,
    diagnostics: params.diagnostics,
    cwd: ctx.cwd,
  };

  pi.sendMessage<DiagnosticFixDetails>(
    {
      customType: DIAGNOSTIC_FIX_CUSTOM_TYPE,
      content: prompt,
      display: true,
      details,
    },
    { triggerTurn: true, deliverAs: "followUp" },
  );

  if (!ctx.isIdle() && ctx.hasUI) ctx.ui.notify("VS Code diagnostic fix request queued.", "info");
}

export function formatRange(range: { start: Position; end: Position }): string {
  const start = formatPosition(range.start);
  const end = formatPosition(range.end);
  return start === end ? start : `${start}-${end}`;
}

export function formatPosition(position: Position): string {
  return `L${position.line + 1}:C${position.character + 1}`;
}

export function formatDiagnosticCode(code: IdeDiagnosticCode): string {
  if (typeof code === "string" || typeof code === "number") return String(code);
  return code.target ? `${code.value} (${code.target})` : String(code.value);
}

function fence(text: string): string {
  const fenceMarker = text.includes("```") ? "````" : "```";
  return `${fenceMarker}\n${text}\n${fenceMarker}`;
}
