// ABOUTME: Covers the lightweight diagnostic message renderer compact/expanded/width behavior.
// ABOUTME: Ensures factory registration stays sync and output never depends on pi-tui.
import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent" with {
  "resolution-mode": "import",
};
import {
  buildDiagnosticFixText,
  createDiagnosticFixComponent,
  DIAGNOSTIC_FIX_CUSTOM_TYPE,
  registerDiagnosticRenderer,
  type DiagnosticFixDetails,
  wrapAnsiText,
} from "../src/pi/diagnostic-renderer.js";
import { visibleWidth } from "../src/shared/display-width.js";
import type { IdeDiagnostic } from "../src/shared/protocol.js";

const sampleDiagnostic: IdeDiagnostic = {
  severity: "error",
  message: "Type 'string' is not assignable to type 'number'.",
  source: "ts",
  code: 2322,
  range: {
    start: { line: 9, character: 4 },
    end: { line: 9, character: 10 },
  },
  selectedText: "value",
  contextLines: [
    { line: 8, text: "const value = getValue();", isPrimary: false },
    { line: 9, text: "const count: number = value;", isPrimary: true },
  ],
};

const ANSI_ESCAPE = String.fromCharCode(27);
const ANSI_SEQUENCE_RE = new RegExp(`${ANSI_ESCAPE}\\[[0-?]*[ -/]*[@-~]`, "g");
const LONG_TOKEN = `TOKEN_${"x".repeat(80)}\tTAIL`;

const sampleDetails: DiagnosticFixDetails = {
  source: "vscode",
  filePath: "/repo/src/main.ts",
  workspaceFolder: "/repo",
  triggerRange: {
    start: { line: 9, character: 4 },
    end: { line: 9, character: 10 },
  },
  diagnostics: [sampleDiagnostic],
  cwd: "/repo",
};

function createTheme(): Theme {
  return {
    fg: (_color: string, text: string) => text,
    bg: (_color: string, text: string) => `BG(${text})`,
    bold: (text: string) => text,
  } as unknown as Theme;
}

function createAnsiTheme(): Theme {
  return {
    fg: (color: string, text: string) =>
      `${ANSI_ESCAPE}[${color === "error" ? "0;31" : "90"}m${text}${ANSI_ESCAPE}[39m`,
    bg: (_color: string, text: string) => `${ANSI_ESCAPE}[40m${text}${ANSI_ESCAPE}[49m`,
    bold: (text: string) => `${ANSI_ESCAPE}[1m${text}${ANSI_ESCAPE}[22m`,
  } as unknown as Theme;
}

void test("registerDiagnosticRenderer registers synchronously", () => {
  let registeredType: string | undefined;
  let registeredRenderer: ((...args: unknown[]) => unknown) | undefined;

  const api = {
    registerMessageRenderer: (customType: string, renderer: (...args: unknown[]) => unknown) => {
      registeredType = customType;
      registeredRenderer = renderer;
    },
  } as unknown as ExtensionAPI;

  registerDiagnosticRenderer(api);

  assert.equal(registeredType, DIAGNOSTIC_FIX_CUSTOM_TYPE);
  assert.equal(typeof registeredRenderer, "function");

  const component = registeredRenderer?.({ details: sampleDetails }, { expanded: false }, createTheme()) as
    | { render: (width: number) => string[]; invalidate: () => void }
    | undefined;

  assert.ok(component);
  assert.equal(typeof component.render, "function");
  assert.equal(typeof component.invalidate, "function");
});

void test("compact diagnostic text shows summary and expand hint", () => {
  const text = buildDiagnosticFixText(sampleDetails, createTheme(), false);
  assert.match(text, /\[DIAGNOSTIC\]/);
  assert.match(text, /Fix 1 diagnostic from VS Code/);
  assert.match(text, /src\/main\.ts/);
  assert.match(text, /ctrl\+o to expand/);
  assert.doesNotMatch(text, /Type 'string' is not assignable/);
});

void test("expanded diagnostic text includes per-diagnostic detail", () => {
  const text = buildDiagnosticFixText(sampleDetails, createTheme(), true);
  assert.match(text, /ERROR #1/);
  assert.match(text, /Type 'string' is not assignable to type 'number'\./);
  assert.match(text, /code: 2322/);
  assert.match(text, /source: ts/);
  assert.match(text, />\s+10:/);
});

void test("diagnostic component respects width and applies background padding", () => {
  const theme = createTheme();
  const component = createDiagnosticFixComponent(sampleDetails, theme, false);
  const width = 40;
  const lines = component.render(width);

  assert.ok(lines.length >= 3, "expected vertical padding around content");
  for (const line of lines) {
    assert.match(line, /^BG\(/);
    // Strip the BG(...) wrapper used by the fake theme.
    const inner = line.slice("BG(".length, -1);
    assert.ok(visibleWidth(inner) === width, `line width ${visibleWidth(inner)} !== ${width}: ${inner}`);
  }

  component.invalidate();
  const again = component.render(width);
  assert.deepEqual(again, lines);
});

void test("ANSI wrapper tracks compound and selective SGR resets across lines", () => {
  const coloredToken = "x".repeat(10);
  const wrapped = wrapAnsiText(`${ANSI_ESCAPE}[0;31m${coloredToken}${ANSI_ESCAPE}[39mplain`, 5);

  assert.equal(wrapped.map((line) => line.replace(ANSI_SEQUENCE_RE, "")).join(""), `${coloredToken}plain`);
  assert.match(wrapped[1] ?? "", new RegExp(`^${escapeRegExp(`${ANSI_ESCAPE}[31m`)}`));
  assert.equal(wrapped.at(-1), "plain", "foreground reset must remove stale color from the next line");
});

void test("ANSI wrapper preserves combined intensity and resets underline before padding", () => {
  const coloredToken = "x".repeat(10);
  const intensityWrapped = wrapAnsiText(`${ANSI_ESCAPE}[1;2m${coloredToken}${ANSI_ESCAPE}[22mplain`, 5);
  assert.match(intensityWrapped[1] ?? "", new RegExp(`^${escapeRegExp(`${ANSI_ESCAPE}[1m${ANSI_ESCAPE}[2m`)}`));
  assert.equal(intensityWrapped.at(-1), "plain");

  const underlineWrapped = wrapAnsiText(`${ANSI_ESCAPE}[4m${coloredToken}${ANSI_ESCAPE}[24mplain`, 5);
  assert.match(underlineWrapped[0] ?? "", new RegExp(`${escapeRegExp(`${ANSI_ESCAPE}[24m`)}$`));
  assert.match(underlineWrapped[1] ?? "", new RegExp(`^${escapeRegExp(`${ANSI_ESCAPE}[4m`)}`));
  assert.equal(underlineWrapped.at(-1), "plain");
});

void test("display width matches host emoji semantics", () => {
  assert.equal(visibleWidth("🇺🇸"), 2);
  assert.equal(visibleWidth("☀️"), 2);
  assert.equal(visibleWidth("1️⃣"), 2);
});

void test("narrow width wraps content without overflowing or truncating it", () => {
  const details: DiagnosticFixDetails = {
    ...sampleDetails,
    diagnostics: [{ ...sampleDiagnostic, message: LONG_TOKEN, contextLines: [] }],
  };
  const component = createDiagnosticFixComponent(details, createAnsiTheme(), true);
  const width = 10;
  const lines = component.render(width);

  for (const line of lines) {
    assert.equal(visibleWidth(line), width, `line width ${visibleWidth(line)} !== ${width}`);
  }

  const flattened = lines
    .map((line) => line.replace(ANSI_SEQUENCE_RE, "").trim())
    .join("")
    .replaceAll(" ", "");
  assert.match(flattened, new RegExp(escapeRegExp(LONG_TOKEN.replace("\t", ""))));
  assert.doesNotMatch(lines.join(""), /\.\.\./, "wrapped diagnostics must not be truncated with an ellipsis");
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
