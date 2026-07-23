// ABOUTME: TUI renderer for VS Code diagnostic-fix custom messages injected by pi-x-ide.
// ABOUTME: Lightweight Component-compatible output so the static shell never imports pi-tui.
import type { ExtensionAPI, Theme, ThemeColor } from "@earendil-works/pi-coding-agent" with {
  "resolution-mode": "import",
};

import { visibleWidth } from "../shared/display-width.js";
import { toRelativeDisplayPath } from "../shared/paths.js";
import type { IdeDiagnostic } from "../shared/protocol.js";
import { formatDiagnosticCode, formatRange } from "./diagnostics.js";
import { DIAGNOSTIC_FIX_CUSTOM_TYPE, type DiagnosticFixDetails } from "./diagnostic-types.js";

export { DIAGNOSTIC_FIX_CUSTOM_TYPE, type DiagnosticFixDetails } from "./diagnostic-types.js";

/** Matches Pi TUI Component shape without importing @earendil-works/pi-tui. */
export interface DiagnosticRenderComponent {
  render(width: number): string[];
  invalidate(): void;
}

const DIAGNOSTIC_BOX_PADDING_X = 1;
const DIAGNOSTIC_BOX_PADDING_Y = 1;
const MIN_CONTENT_WIDTH = 1;
const TAB_REPLACEMENT = "   ";
const ESCAPE_CHARACTER = String.fromCharCode(27);
const ANSI_SEQUENCE_AT_START = new RegExp(`^${ESCAPE_CHARACTER}\\[[0-?]*[ -/]*[@-~]`);
const GRAPHEME_SEGMENTER =
  typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : undefined;
const SGR_CODES = {
  reset: 0,
  bold: 1,
  dim: 2,
  italic: 3,
  underline: 4,
  slowBlink: 5,
  rapidBlink: 6,
  inverse: 7,
  conceal: 8,
  strikethrough: 9,
  doubleUnderline: 21,
  intensityReset: 22,
  italicReset: 23,
  underlineReset: 24,
  blinkReset: 25,
  inverseReset: 27,
  concealReset: 28,
  strikethroughReset: 29,
  foregroundStart: 30,
  foregroundEnd: 37,
  extendedForeground: 38,
  foregroundReset: 39,
  backgroundStart: 40,
  backgroundEnd: 47,
  extendedBackground: 48,
  backgroundReset: 49,
  overline: 53,
  overlineReset: 55,
  extendedUnderlineColor: 58,
  underlineColorReset: 59,
  brightForegroundStart: 90,
  brightForegroundEnd: 97,
  brightBackgroundStart: 100,
  brightBackgroundEnd: 107,
} as const;
const SGR_INDEXED_COLOR_MODE = 5;
const SGR_TRUE_COLOR_MODE = 2;
const SGR_INDEXED_COLOR_PARAMETER_COUNT = 2;
const SGR_TRUE_COLOR_PARAMETER_COUNT = 4;
const SGR_STYLE_GROUPS = new Map<number, string>([
  [SGR_CODES.bold, "bold"],
  [SGR_CODES.dim, "dim"],
  [SGR_CODES.italic, "italic"],
  [SGR_CODES.underline, "underline"],
  [SGR_CODES.slowBlink, "blink"],
  [SGR_CODES.rapidBlink, "blink"],
  [SGR_CODES.inverse, "inverse"],
  [SGR_CODES.conceal, "conceal"],
  [SGR_CODES.strikethrough, "strikethrough"],
  [SGR_CODES.doubleUnderline, "underline"],
  [SGR_CODES.overline, "overline"],
]);
const SGR_STYLE_RESETS = new Map<number, readonly string[]>([
  [SGR_CODES.intensityReset, ["bold", "dim"]],
  [SGR_CODES.italicReset, ["italic"]],
  [SGR_CODES.underlineReset, ["underline"]],
  [SGR_CODES.blinkReset, ["blink"]],
  [SGR_CODES.inverseReset, ["inverse"]],
  [SGR_CODES.concealReset, ["conceal"]],
  [SGR_CODES.strikethroughReset, ["strikethrough"]],
  [SGR_CODES.overlineReset, ["overline"]],
]);

export function registerDiagnosticRenderer(pi: ExtensionAPI): void {
  pi.registerMessageRenderer<DiagnosticFixDetails>(DIAGNOSTIC_FIX_CUSTOM_TYPE, (message, { expanded }, theme) => {
    const details = message.details;
    if (!details) return undefined;
    return createDiagnosticFixComponent(details, theme, expanded);
  });
}

export function createDiagnosticFixComponent(
  details: DiagnosticFixDetails,
  theme: Theme,
  expanded: boolean,
): DiagnosticRenderComponent {
  return new DiagnosticMessageComponent(buildText(details, theme, expanded), (text) =>
    theme.bg("customMessageBg", text),
  );
}

class DiagnosticMessageComponent implements DiagnosticRenderComponent {
  private cache: { width: number; lines: string[] } | undefined;

  constructor(
    private readonly text: string,
    private readonly bgFn: (text: string) => string,
  ) {}

  invalidate(): void {
    this.cache = undefined;
  }

  render(width: number): string[] {
    if (this.cache?.width === width) return this.cache.lines;

    const contentWidth = Math.max(MIN_CONTENT_WIDTH, width - DIAGNOSTIC_BOX_PADDING_X * 2);
    const leftPad = " ".repeat(DIAGNOSTIC_BOX_PADDING_X);
    const lines: string[] = [];

    for (let index = 0; index < DIAGNOSTIC_BOX_PADDING_Y; index += 1) {
      lines.push(this.padAndApplyBackground("", width));
    }

    for (const wrappedLine of wrapAnsiText(this.text, contentWidth)) {
      lines.push(this.padAndApplyBackground(leftPad + wrappedLine, width));
    }

    for (let index = 0; index < DIAGNOSTIC_BOX_PADDING_Y; index += 1) {
      lines.push(this.padAndApplyBackground("", width));
    }

    this.cache = { width, lines };
    return lines;
  }

  private padAndApplyBackground(line: string, width: number): string {
    const padNeeded = Math.max(0, width - visibleWidth(line));
    return this.bgFn(line + " ".repeat(padNeeded));
  }
}

export function wrapAnsiText(text: string, width: number): string[] {
  const normalizedText = text.replaceAll("\t", TAB_REPLACEMENT);
  const lines: string[] = [];
  const sgrState = new SgrState();

  for (const logicalLine of normalizedText.split("\n")) {
    lines.push(...wrapAnsiLine(logicalLine, width, sgrState));
  }

  return lines.length > 0 ? lines : [""];
}

function wrapAnsiLine(line: string, width: number, sgrState: SgrState): string[] {
  const lines: string[] = [];
  let currentLine = sgrState.toAnsi();
  let currentWidth = 0;
  let index = 0;

  while (index < line.length) {
    const ansiSequence = readAnsiSequence(line, index);
    if (ansiSequence) {
      currentLine += ansiSequence;
      sgrState.process(ansiSequence);
      index += ansiSequence.length;
      continue;
    }
    if (line[index] === ESCAPE_CHARACTER) {
      currentLine += ESCAPE_CHARACTER;
      index += 1;
      continue;
    }

    const nextEscape = line.indexOf(ESCAPE_CHARACTER, index);
    const textEnd = nextEscape === -1 ? line.length : nextEscape;
    const textChunk = line.slice(index, textEnd);

    for (const grapheme of segmentGraphemes(textChunk)) {
      const graphemeWidth = visibleWidth(grapheme);
      if (currentWidth > 0 && currentWidth + graphemeWidth > width) {
        lines.push(currentLine + sgrState.lineEndReset());
        currentLine = sgrState.toAnsi();
        currentWidth = 0;
      }
      currentLine += grapheme;
      currentWidth += graphemeWidth;
    }

    index = textEnd;
  }

  lines.push(currentLine + sgrState.lineEndReset());
  return lines;
}

function readAnsiSequence(text: string, index: number): string | undefined {
  if (text[index] !== ESCAPE_CHARACTER) return undefined;
  return ANSI_SEQUENCE_AT_START.exec(text.slice(index))?.[0];
}

class SgrState {
  private readonly activeCodes = new Map<string, string>();

  process(sequence: string): void {
    if (!sequence.endsWith("m")) return;
    const rawParameters = sequence.slice(2, -1);
    const parameters = rawParameters === "" ? [SGR_CODES.reset] : rawParameters.split(";").map(Number);

    for (let index = 0; index < parameters.length; index += 1) {
      const code = parameters[index];
      if (!Number.isInteger(code)) continue;
      if (code === SGR_CODES.reset) {
        this.activeCodes.clear();
        continue;
      }

      const styleGroup = SGR_STYLE_GROUPS.get(code);
      if (styleGroup) {
        this.activeCodes.set(styleGroup, formatSgrSequence([code]));
        continue;
      }

      const resetGroups = SGR_STYLE_RESETS.get(code);
      if (resetGroups) {
        for (const resetGroup of resetGroups) this.activeCodes.delete(resetGroup);
        continue;
      }

      if (isStandardForegroundCode(code)) {
        this.activeCodes.set("foreground", formatSgrSequence([code]));
        continue;
      }
      if (code === SGR_CODES.foregroundReset) {
        this.activeCodes.delete("foreground");
        continue;
      }
      if (isStandardBackgroundCode(code)) {
        this.activeCodes.set("background", formatSgrSequence([code]));
        continue;
      }
      if (code === SGR_CODES.backgroundReset) {
        this.activeCodes.delete("background");
        continue;
      }
      if (code === SGR_CODES.underlineColorReset) {
        this.activeCodes.delete("underline-color");
        continue;
      }

      const extendedGroup = getExtendedColorGroup(code);
      if (extendedGroup) {
        const parameterCount = getExtendedColorParameterCount(parameters[index + 1]);
        if (parameterCount === 0 || index + parameterCount >= parameters.length) continue;
        const colorParameters = parameters.slice(index, index + parameterCount + 1);
        this.activeCodes.set(extendedGroup, formatSgrSequence(colorParameters));
        index += parameterCount;
      }
    }
  }

  toAnsi(): string {
    return [...this.activeCodes.values()].join("");
  }

  lineEndReset(): string {
    return this.activeCodes.has("underline") ? formatSgrSequence([SGR_CODES.underlineReset]) : "";
  }
}

function isStandardForegroundCode(code: number): boolean {
  return (
    (code >= SGR_CODES.foregroundStart && code <= SGR_CODES.foregroundEnd) ||
    (code >= SGR_CODES.brightForegroundStart && code <= SGR_CODES.brightForegroundEnd)
  );
}

function isStandardBackgroundCode(code: number): boolean {
  return (
    (code >= SGR_CODES.backgroundStart && code <= SGR_CODES.backgroundEnd) ||
    (code >= SGR_CODES.brightBackgroundStart && code <= SGR_CODES.brightBackgroundEnd)
  );
}

function getExtendedColorGroup(code: number): string | undefined {
  if (code === SGR_CODES.extendedForeground) return "foreground";
  if (code === SGR_CODES.extendedBackground) return "background";
  if (code === SGR_CODES.extendedUnderlineColor) return "underline-color";
  return undefined;
}

function getExtendedColorParameterCount(mode: number | undefined): number {
  if (mode === SGR_INDEXED_COLOR_MODE) return SGR_INDEXED_COLOR_PARAMETER_COUNT;
  if (mode === SGR_TRUE_COLOR_MODE) return SGR_TRUE_COLOR_PARAMETER_COUNT;
  return 0;
}

function formatSgrSequence(parameters: number[]): string {
  return `${ESCAPE_CHARACTER}[${parameters.join(";")}m`;
}

function* segmentGraphemes(text: string): Iterable<string> {
  if (GRAPHEME_SEGMENTER) {
    for (const segment of GRAPHEME_SEGMENTER.segment(text)) yield segment.segment;
    return;
  }
  yield* text;
}

export function buildDiagnosticFixText(details: DiagnosticFixDetails, theme: Theme, expanded: boolean): string {
  return buildText(details, theme, expanded);
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
