import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDiagnosticContextMessage,
  buildDiagnosticFixPrompt,
  handleDiagnosticFixRequested,
} from "../src/pi/diagnostics.js";
import { readPiConfigFixPrompt } from "../src/shared/config.js";
import { createRuntime } from "../src/pi/state.js";
import type { DiagnosticFixRequestedParams } from "../src/shared/protocol.js";
import { isDiagnosticFixRequestedParams } from "../src/shared/schema.js";

const diagnosticPayload: DiagnosticFixRequestedParams = {
  source: "vscode",
  filePath: "/repo/src/main.ts",
  workspaceFolder: "/repo",
  documentVersion: 7,
  triggerRange: {
    start: { line: 9, character: 4 },
    end: { line: 9, character: 10 },
  },
  diagnostics: [
    {
      severity: "error",
      message: "Type 'string' is not assignable to type 'number'.",
      source: "ts",
      code: { value: 2322, target: "https://typescript.tv/errors/2322" },
      range: {
        start: { line: 9, character: 4 },
        end: { line: 9, character: 10 },
      },
      selectedText: "value",
      contextLines: [
        { line: 8, text: "const value = getValue();", isPrimary: false },
        { line: 9, text: "const count: number = value;", isPrimary: true },
        { line: 10, text: "console.log(count);", isPrimary: false },
      ],
      relatedInformation: [
        {
          filePath: "/repo/src/types.ts",
          range: {
            start: { line: 1, character: 0 },
            end: { line: 1, character: 16 },
          },
          message: "The expected type is declared here.",
        },
      ],
    },
  ],
  receivedAt: 1780963200000,
};

void test("validates diagnostic fix request params", () => {
  assert.equal(isDiagnosticFixRequestedParams(diagnosticPayload), true);
  assert.equal(isDiagnosticFixRequestedParams({ ...diagnosticPayload, action: "send-diagnostic" }), true);
  assert.equal(isDiagnosticFixRequestedParams({ ...diagnosticPayload, action: "explain" }), false);
  assert.equal(isDiagnosticFixRequestedParams({ ...diagnosticPayload, diagnostics: [] }), false);
  assert.equal(isDiagnosticFixRequestedParams({ ...diagnosticPayload, source: "zed" }), false);
  assert.equal(isDiagnosticFixRequestedParams({ ...diagnosticPayload, source: "nvim" }), false);
  assert.equal(
    isDiagnosticFixRequestedParams({
      ...diagnosticPayload,
      diagnostics: [{ ...diagnosticPayload.diagnostics[0], severity: "information" }],
    }),
    false,
  );
  assert.equal(
    isDiagnosticFixRequestedParams({
      ...diagnosticPayload,
      diagnostics: [{ ...diagnosticPayload.diagnostics[0], range: { start: { line: -1, character: 0 } } }],
    }),
    false,
  );
});

void test("builds diagnostic fix prompt from payload", () => {
  const prompt = buildDiagnosticFixPrompt(diagnosticPayload);

  assert.match(prompt, /pi-x-ide\/diagnostic-context/);
  assert.match(prompt, /^Analyze the errors and warnings at the following location, and try to fix them:/);
  assert.match(prompt, /File: \/repo\/src\/main\.ts/);
  assert.match(prompt, /Severity: error/);
  assert.match(prompt, /Source: ts/);
  assert.match(prompt, /Code: 2322 \(https:\/\/typescript\.tv\/errors\/2322\)/);
  assert.match(prompt, /Type 'string' is not assignable to type 'number'\./);
  assert.match(prompt, /```\nvalue\n```/);
  assert.match(prompt, /> 10: const count: number = value;/);
  assert.match(prompt, /\/repo\/src\/types\.ts L2:C1-L2:C17: The expected type is declared here\./);
});

void test("replaces {DIAGNOSTIC} placeholder with context when fix prompt includes it", () => {
  const prompt = buildDiagnosticFixPrompt(diagnosticPayload, {
    fixPrompt: "Fix the problem:\n{DIAGNOSTIC}",
  });

  assert.doesNotMatch(prompt, /{DIAGNOSTIC}/);
  assert.match(prompt, /^Fix the problem:/);
  assert.match(prompt, /pi-x-ide\/diagnostic-context/);
  assert.match(prompt, /Type 'string' is not assignable to type 'number'\./);
});

void test("appends context after prompt when fix prompt omits {DIAGNOSTIC}", () => {
  const contextMarker = "<!-- pi-x-ide/diagnostic-context -->";
  const prompt = buildDiagnosticFixPrompt(diagnosticPayload, {
    fixPrompt: "Please fix the following issue.",
  });

  assert.match(prompt, /^Please fix the following issue\./);
  assert.match(prompt, /pi-x-ide\/diagnostic-context/);
  // Context should appear after the prompt
  const contextIndex = prompt.indexOf(contextMarker);
  const promptEndIndex = prompt.indexOf("Please fix the following issue.") + "Please fix the following issue.".length;
  assert.ok(contextIndex > promptEndIndex);
});

void test("falls back to default prompt when fix prompt is empty", () => {
  const prompt = buildDiagnosticFixPrompt(diagnosticPayload, { fixPrompt: "" });

  assert.match(prompt, /^Analyze the errors and warnings/);
  assert.match(prompt, /pi-x-ide\/diagnostic-context/);
});

void test("builds diagnostic context message without triggering fix instructions", () => {
  const message = buildDiagnosticContextMessage(diagnosticPayload);

  assert.doesNotMatch(message, /^<!-- Diagnostic Context -->/);
  assert.match(message, /File: \/repo\/src\/main\.ts/);
  assert.doesNotMatch(message, /try to fix/);
  assert.match(message, /<!-- pi-x-ide\/diagnostic-context -->/);
});

void test("sends diagnostic fix prompt immediately when Pi is idle", () => {
  const runtime = createRuntime();
  runtime.ctx = createContext({ idle: true });
  const sent: Array<{ message: SentMessage; options?: unknown }> = [];
  const pi = createPi(sent);

  handleDiagnosticFixRequested(pi, runtime, diagnosticPayload);

  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.message.customType, "pi-x-ide/diagnostic-fix");
  assert.equal(sent[0]?.message.display, true);
  assert.match(String(sent[0]?.message.content), /pi-x-ide\/diagnostic-context/);
  assert.deepEqual(sent[0]?.options, { triggerTurn: true, deliverAs: "followUp" });
  const details = sent[0]?.message.details as { filePath: string; diagnostics: unknown[] } | undefined;
  assert.equal(details?.filePath, "/repo/src/main.ts");
  assert.equal(details?.diagnostics.length, 1);
});

void test("queues diagnostic fix prompt as follow-up when Pi is busy", () => {
  const runtime = createRuntime();
  const notifications: string[] = [];
  runtime.ctx = createContext({ idle: false, notifications });
  const sent: Array<{ message: SentMessage; options?: unknown }> = [];
  const pi = createPi(sent);

  handleDiagnosticFixRequested(pi, runtime, diagnosticPayload);

  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0]?.options, { triggerTurn: true, deliverAs: "followUp" });
  assert.equal(sent[0]?.message.customType, "pi-x-ide/diagnostic-fix");
  assert.deepEqual(notifications, ["VS Code diagnostic fix request queued."]);
});

void test("readPiConfigFixPrompt returns undefined for missing config file", () => {
  const result = readPiConfigFixPrompt("/nonexistent/path/config.json");
  assert.equal(result, undefined);
});

void test("pastes diagnostic context into Pi input for send diagnostic requests", () => {
  const runtime = createRuntime();
  const notifications: string[] = [];
  const pasted: string[] = [];
  runtime.ctx = createContext({ idle: true, notifications, pasted });
  const sent: Array<{ message: SentMessage; options?: unknown }> = [];
  const pi = createPi(sent);

  handleDiagnosticFixRequested(pi, runtime, { ...diagnosticPayload, action: "send-diagnostic" });

  assert.equal(sent.length, 0);
  assert.equal(pasted.length, 1);
  assert.match(pasted[0] ?? "", /pi-x-ide\/diagnostic-context/);
  assert.match(pasted[0] ?? "", /Type 'string' is not assignable to type 'number'\./);
  assert.deepEqual(notifications, ["VS Code diagnostic context added to input."]);
});

type SentMessage = {
  customType: string;
  content: unknown;
  display: boolean;
  details?: unknown;
};

function createPi(
  sent: Array<{ message: SentMessage; options?: unknown }>,
): Parameters<typeof handleDiagnosticFixRequested>[0] {
  return {
    sendMessage: (message: SentMessage, options?: unknown) => {
      sent.push({ message, options });
    },
  } as Parameters<typeof handleDiagnosticFixRequested>[0];
}

function createContext(options: {
  idle: boolean;
  notifications?: string[];
  pasted?: string[];
}): NonNullable<ReturnType<typeof createRuntime>["ctx"]> {
  return {
    cwd: "/repo",
    hasUI: true,
    isIdle: () => options.idle,
    ui: {
      notify: (message: string) => options.notifications?.push(message),
      pasteToEditor: (text: string) => options.pasted?.push(text),
    },
  } as NonNullable<ReturnType<typeof createRuntime>["ctx"]>;
}
