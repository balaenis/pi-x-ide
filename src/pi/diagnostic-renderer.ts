// ABOUTME: TUI renderer for VS Code diagnostic-fix custom messages injected by pi-x-ide.
// ABOUTME: Renders a compact summary with severity color, expandable to per-diagnostic detail.
import type { ExtensionAPI, Theme, ThemeColor } from "@earendil-works/pi-coding-agent" with {
  "resolution-mode": "import",
};
import { Box, Text, type Component } from "@earendil-works/pi-tui";

import type { DiagnosticFixRequestedParams, IdeDiagnostic, Position } from "../shared/protocol.js";
import { toRelativeDisplayPath } from "../shared/paths.js";
import { formatDiagnosticCode, formatRange } from "./diagnostics.js";

export const DIAGNOSTIC_FIX_CUSTOM_TYPE = "pi-x-ide/diagnostic-fix";

export interface DiagnosticFixDetails {
  source: DiagnosticFixRequestedParams["source"];
  filePath: string;
  workspaceFolder?: string;
  triggerRange: { start: Position; end: Position };
  diagnostics: IdeDiagnostic[];
  cwd?: string;
}

export function registerDiagnosticRenderer(pi: ExtensionAPI): void {
  pi.registerMessageRenderer<DiagnosticFixDetails>(DIAGNOSTIC_FIX_CUSTOM_TYPE, (message, { expanded }, theme) => {
    const details = message.details;
    if (!details) return undefined;
    return buildComponent(details, theme, expanded);
  });
}

function buildComponent(details: DiagnosticFixDetails, theme: Theme, expanded: boolean): Component {
  const box = new Box(1, 1, (t) => theme.bg("customMessageBg", t));
  box.addChild(new Text(buildText(details, theme, expanded), 0, 0));
  return box;
}

function buildText(details: DiagnosticFixDetails, theme: Theme, expanded: boolean): string {
  const severityColor = pickSeverityColor(details.diagnostics);
  const label = theme.fg(severityColor, theme.bold("[DIAGNOSTIC]"));
  const sourceLabel = describeSource(details.source);
  const relPath = toRelativeDisplayPath(details.filePath, details.workspaceFolder, details.cwd);
  const location = theme.fg("dim", `${relPath}:${formatRange(details.triggerRange)}`);
  const count = details.diagnostics.length;
  const noun = count === 1 ? "diagnostic" : "diagnostics";
  const header = `${label} Fix ${count} ${noun} from ${sourceLabel} — ${location}`;

  if (!expanded) {
    return `${header}\n${theme.fg("dim", "ctrl+o to expand")}`;
  }

  const lines: string[] = [header];
  for (const [index, diagnostic] of details.diagnostics.entries()) {
    lines.push("");
    lines.push(formatDiagnostic(diagnostic, index, details, theme));
  }
  return lines.join("\n");
}

function formatDiagnostic(
  diagnostic: IdeDiagnostic,
  index: number,
  details: DiagnosticFixDetails,
  theme: Theme,
): string {
  const color: ThemeColor = diagnostic.severity === "error" ? "error" : "warning";
  const headerText = `${diagnostic.severity.toUpperCase()} #${index + 1}`;
  const lines: string[] = [`${theme.fg(color, headerText)} ${theme.fg("dim", formatRange(diagnostic.range))}`];

  if (diagnostic.code !== undefined) {
    lines.push(theme.fg("dim", `  code: ${formatDiagnosticCode(diagnostic.code)}`));
  }
  if (diagnostic.source) {
    lines.push(theme.fg("dim", `  source: ${diagnostic.source}`));
  }
  lines.push(`  ${diagnostic.message}`);

  if (diagnostic.contextLines.length > 0) {
    for (const contextLine of diagnostic.contextLines) {
      const marker = contextLine.isPrimary ? theme.fg(color, ">") : " ";
      const lineNumber = theme.fg("dim", `${contextLine.line + 1}:`.padStart(4, " "));
      lines.push(`  ${marker} ${lineNumber} ${contextLine.text}`);
    }
  }

  if (diagnostic.relatedInformation && diagnostic.relatedInformation.length > 0) {
    lines.push(theme.fg("dim", "  related:"));
    for (const related of diagnostic.relatedInformation) {
      const relatedPath = toRelativeDisplayPath(related.filePath, details.workspaceFolder, details.cwd);
      lines.push(theme.fg("dim", `    ${relatedPath} ${formatRange(related.range)}: ${related.message}`));
    }
  }

  return lines.join("\n");
}

function pickSeverityColor(diagnostics: IdeDiagnostic[]): ThemeColor {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error") ? "error" : "warning";
}

function describeSource(source: DiagnosticFixDetails["source"]): string {
  if (source === "vscode") return "VS Code";
  return source;
}
