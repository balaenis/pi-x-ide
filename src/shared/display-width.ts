// ABOUTME: Measures and truncates terminal text by displayed cell width.
// ABOUTME: Handles wide CJK/Hangul/emoji graphemes so TUI widgets fit terminal columns.
const ESC = String.fromCharCode(27);
const ANSI_PATTERN = new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]`, "g");
const EMOJI_VARIATION_SELECTOR = 0xfe0f;
const COMBINING_ENCLOSING_KEYCAP = 0x20e3;

const graphemeSegmenter =
  typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : undefined;

export function visibleWidth(input: string): number {
  let width = 0;
  for (const grapheme of graphemes(stripAnsi(input))) width += graphemeWidth(grapheme);
  return width;
}

export function truncateToWidth(input: string, maxWidth: number, ellipsis = "...", pad = false): string {
  if (maxWidth <= 0) return "";
  const inputWidth = visibleWidth(input);
  if (inputWidth <= maxWidth) return padToWidth(input, maxWidth, pad);

  const suffix = fitSuffix(ellipsis, maxWidth);
  const suffixWidth = visibleWidth(suffix);
  const contentLimit = Math.max(0, maxWidth - suffixWidth);
  let output = "";
  let used = 0;

  for (const grapheme of graphemes(stripAnsi(input))) {
    const width = graphemeWidth(grapheme);
    if (used + width > contentLimit) break;
    output += grapheme;
    used += width;
  }

  return padToWidth(output + suffix, maxWidth, pad);
}

function stripAnsi(input: string): string {
  return input.replace(ANSI_PATTERN, "");
}

function* graphemes(input: string): Iterable<string> {
  if (graphemeSegmenter) {
    for (const segment of graphemeSegmenter.segment(input)) yield segment.segment;
    return;
  }

  yield* input;
}

function padToWidth(input: string, maxWidth: number, pad: boolean): string {
  if (!pad) return input;
  return input + " ".repeat(Math.max(0, maxWidth - visibleWidth(input)));
}

function fitSuffix(ellipsis: string, maxWidth: number): string {
  if (visibleWidth(ellipsis) <= maxWidth) return ellipsis;
  let output = "";
  let used = 0;
  for (const grapheme of graphemes(stripAnsi(ellipsis))) {
    const width = graphemeWidth(grapheme);
    if (used + width > maxWidth) break;
    output += grapheme;
    used += width;
  }
  return output;
}

function graphemeWidth(grapheme: string): number {
  if (grapheme.length === 0) return 0;
  const codePoints = [...grapheme].map((char) => char.codePointAt(0)).filter((value) => value !== undefined);
  if (codePoints.every(isZeroWidthCodePoint)) return 0;
  if (codePoints.every(isControlCodePoint)) return 0;
  if (codePoints.includes(EMOJI_VARIATION_SELECTOR) || codePoints.includes(COMBINING_ENCLOSING_KEYCAP)) return 2;
  return codePoints.some(isWideCodePoint) ? 2 : 1;
}

function isZeroWidthCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x0300 && codePoint <= 0x036f) ||
    (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
    (codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
    (codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
    (codePoint >= 0xfe20 && codePoint <= 0xfe2f) ||
    codePoint === 0x200d ||
    codePoint === 0xfe0e ||
    codePoint === 0xfe0f
  );
}

function isControlCodePoint(codePoint: number): boolean {
  return codePoint <= 0x001f || (codePoint >= 0x007f && codePoint <= 0x009f);
}

function isWideCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x1100 && codePoint <= 0x11ff) ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f1e6 && codePoint <= 0x1f1ff) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1faff) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  );
}
