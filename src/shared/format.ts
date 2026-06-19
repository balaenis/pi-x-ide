import type { EditorSelectionSnapshot, SelectionRange } from "./protocol";
import { toRelativeDisplayPath } from "./paths";

export const SYSTEM_REMINDER_TAG = "system-reminder";

export function rangeToLineSpan(range: SelectionRange): { startLine: number; endLine: number } {
  return {
    startLine: range.selection.start.line + 1,
    endLine: range.selection.end.line + 1,
  };
}

// Line-only range token, dash separated: `L9` for a single line, `L9-L20` for a span.
export function formatLineRange(range: SelectionRange): string {
  const { startLine, endLine } = rangeToLineSpan(range);
  return startLine === endLine ? `L${startLine}` : `L${startLine}-L${endLine}`;
}

export function formatLineSpan(range: SelectionRange): string {
  return `#${formatLineRange(range)}`;
}

export function formatRangeMention(snapshot: EditorSelectionSnapshot, options: { cwd?: string } = {}): string {
  const rel = toRelativeDisplayPath(snapshot.filePath, snapshot.workspaceFolder, options.cwd);
  const first = snapshot.ranges[0];
  return first ? `@${rel}${formatLineSpan(first)}` : `@${rel}`;
}

export interface ParsedRangeMention {
  path: string;
  startLine?: number;
  endLine?: number;
}

// Parses the dash line-range form: `#L<line>(-L<line>)?`, e.g. `#L10`, `#L10-L20`.
export function parseRangeMention(input: string): ParsedRangeMention | undefined {
  const match = input.trim().match(/^@(.+?)(?:#L(\d+)(?:-L(\d+))?)?$/);
  if (!match) return undefined;
  const startLine = match[2] ? Number(match[2]) : undefined;
  const endLine = match[3] ? Number(match[3]) : startLine;
  for (const value of [startLine, endLine]) {
    if (value !== undefined && (!Number.isInteger(value) || value < 1)) return undefined;
  }
  return { path: match[1], startLine, endLine };
}

export function describeRanges(ranges: SelectionRange[]): string {
  if (ranges.length === 0) return "open file";
  if (ranges.length === 1) return formatLineSpan(ranges[0]);
  return ranges.map((range, index) => `${index + 1}:${formatLineSpan(range)}`).join(" ");
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

export function formatEditorContext(snapshot: EditorSelectionSnapshot, options: { maxChars?: number } = {}): string {
  const filePath = snapshot.filePath;
  const maxChars = options.maxChars ?? 24_000;

  if (snapshot.ranges.length === 0) {
    return `<${SYSTEM_REMINDER_TAG}>\nThe user currently has \`${filePath}\` open in ${snapshot.source}. This may or may not be relevant.\n</${SYSTEM_REMINDER_TAG}>\n`;
  }

  const sections: string[] = [];
  let remaining = maxChars;
  let truncated = false;

  for (const [index, range] of snapshot.ranges.entries()) {
    const label = snapshot.ranges.length === 1 ? "The user selected" : `Selection ${index + 1}`;
    let text = range.text;
    if (text.length > remaining) {
      text = text.slice(0, Math.max(0, remaining));
      truncated = true;
    }
    remaining -= text.length;

    const rangeStr = formatLineRange(range);
    sections.push(`${label} ${rangeStr} from \`${filePath}\` in ${snapshot.source}:\n\`\`\`\n${text}\n\`\`\``);

    if (remaining <= 0) break;
  }

  const suffix = truncated ? "\n[Selection text truncated to keep the prompt size bounded.]" : "";
  return `<${SYSTEM_REMINDER_TAG}>\n${sections.join("\n")}\nThis may or may not be relevant.${suffix}\n</${SYSTEM_REMINDER_TAG}>\n`;
}
