import type { EditorSelectionSnapshot, SelectionRange } from "./protocol";
import { toRelativeDisplayPath } from "./paths";

export type RangeFormat = "comma" | "dash";

export function rangeToLineSpan(range: SelectionRange): { startLine: number; endLine: number } {
  return {
    startLine: range.selection.start.line + 1,
    endLine: range.selection.end.line + 1,
  };
}

export function formatLineSpan(range: SelectionRange, format: RangeFormat = "comma"): string {
  const { startLine, endLine } = rangeToLineSpan(range);
  if (startLine === endLine) return `#L${startLine}`;
  return format === "dash" ? `#L${startLine}-L${endLine}` : `#L${startLine},${endLine}`;
}

export function formatRangeMention(
  snapshot: EditorSelectionSnapshot,
  options: { cwd?: string; format?: RangeFormat } = {},
): string {
  const rel = toRelativeDisplayPath(snapshot.filePath, snapshot.workspaceFolder, options.cwd);
  const first = snapshot.ranges[0];
  return first ? `@${rel}${formatLineSpan(first, options.format)}` : `@${rel}`;
}

export interface ParsedRangeMention {
  path: string;
  startLine?: number;
  endLine?: number;
}

export function parseRangeMention(input: string): ParsedRangeMention | undefined {
  const match = input.trim().match(/^@(.+?)(?:#L(\d+)(?:(?:,|-L?)(\d+))?)?$/);
  if (!match) return undefined;
  const startLine = match[2] ? Number(match[2]) : undefined;
  const endLine = match[3] ? Number(match[3]) : startLine;
  if (startLine !== undefined && (!Number.isInteger(startLine) || startLine < 1)) return undefined;
  if (endLine !== undefined && (!Number.isInteger(endLine) || endLine < 1)) return undefined;
  return { path: match[1]!, startLine, endLine };
}

export function describeRanges(ranges: SelectionRange[], format: RangeFormat = "comma"): string {
  if (ranges.length === 0) return "open file";
  if (ranges.length === 1) return formatLineSpan(ranges[0]!, format);
  return ranges.map((range, index) => `${index + 1}:${formatLineSpan(range, format)}`).join(" ");
}

export function snapshotKey(snapshot: EditorSelectionSnapshot): string {
  return JSON.stringify({
    source: snapshot.source,
    filePath: snapshot.filePath,
    workspaceFolder: snapshot.workspaceFolder,
    ranges: snapshot.ranges.map((range) => ({
      start: range.selection.start,
      end: range.selection.end,
      textLength: range.text.length,
    })),
  });
}

export function formatEditorContext(
  snapshot: EditorSelectionSnapshot,
  options: { cwd?: string; maxChars?: number } = {},
): string {
  const rel = toRelativeDisplayPath(snapshot.filePath, snapshot.workspaceFolder, options.cwd);
  const maxChars = options.maxChars ?? 24_000;

  if (snapshot.ranges.length === 0) {
    return `<system-reminder>\nThe user currently has \`${rel}\` open in ${snapshot.source}. This may or may not be relevant.\n</system-reminder>`;
  }

  const sections: string[] = [];
  let remaining = maxChars;
  let truncated = false;

  for (const [index, range] of snapshot.ranges.entries()) {
    const { startLine, endLine } = rangeToLineSpan(range);
    const label = snapshot.ranges.length === 1 ? "The user selected" : `Selection ${index + 1}`;
    let text = range.text;
    if (text.length > remaining) {
      text = text.slice(0, Math.max(0, remaining));
      truncated = true;
    }
    remaining -= text.length;
    sections.push(`${label} lines ${startLine}-${endLine} from \`${rel}\` in ${snapshot.source}:\n\n\`\`\`\n${text}\n\`\`\``);
    if (remaining <= 0) break;
  }

  const suffix = truncated ? "\n\n[Selection text truncated to keep the prompt size bounded.]" : "";
  return `<system-reminder>\n${sections.join("\n\n")}\n\nThis may or may not be relevant.${suffix}\n</system-reminder>`;
}
