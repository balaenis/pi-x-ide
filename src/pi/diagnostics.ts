import type { ExtensionAPI } from "@earendil-works/pi-coding-agent" with { "resolution-mode": "import" };
import { toRelativeDisplayPath } from "../shared/paths";
import type { DiagnosticFixRequestedParams, IdeDiagnosticCode, Position } from "../shared/protocol";
import type { PiIdeRuntime } from "./state";

export const DIAGNOSTIC_CONTEXT_MARKER = "pi-x-ide/diagnostic-context";

export function buildDiagnosticFixPrompt(params: DiagnosticFixRequestedParams, options: { cwd?: string } = {}): string {
  return `Analyze the errors and warnings at the following location, and try to fix them:
<!-- ${DIAGNOSTIC_CONTEXT_MARKER} -->
${formatDiagnosticContext(params, options)}`;
}

export function formatDiagnosticContext(params: DiagnosticFixRequestedParams, options: { cwd?: string } = {}): string {
  const rel = toRelativeDisplayPath(params.filePath, params.workspaceFolder, options.cwd);
  const lines = [`File: ${rel}`, `Source: ${params.source}`];
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
        const marker = contextLine.isPrimary ? ">" : " ";
        lines.push(`  ${marker} ${contextLine.line + 1}: ${contextLine.text}`);
      }
    }

    if (diagnostic.relatedInformation && diagnostic.relatedInformation.length > 0) {
      lines.push("- Related information:");
      for (const related of diagnostic.relatedInformation) {
        const relatedPath = toRelativeDisplayPath(related.filePath, params.workspaceFolder, options.cwd);
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

  const prompt = buildDiagnosticFixPrompt(params, { cwd: ctx.cwd });
  if (ctx.isIdle()) {
    pi.sendUserMessage(prompt);
    return;
  }

  pi.sendUserMessage(prompt, { deliverAs: "followUp" });
  if (ctx.hasUI) ctx.ui.notify("VS Code diagnostic fix request queued.", "info");
}

function formatRange(range: { start: Position; end: Position }): string {
  const start = formatPosition(range.start);
  const end = formatPosition(range.end);
  return start === end ? start : `${start}-${end}`;
}

function formatPosition(position: Position): string {
  return `L${position.line + 1}:C${position.character + 1}`;
}

function formatDiagnosticCode(code: IdeDiagnosticCode): string {
  if (typeof code === "string" || typeof code === "number") return String(code);
  return code.target ? `${code.value} (${code.target})` : String(code.value);
}

function fence(text: string): string {
  const fenceMarker = text.includes("```") ? "````" : "```";
  return `${fenceMarker}\n${text}\n${fenceMarker}`;
}
