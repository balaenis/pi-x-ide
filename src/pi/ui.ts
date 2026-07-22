// ABOUTME: Renders pi-x-ide's TUI status widget or footer statusline for IDE state.
// ABOUTME: Provides safe UI update helpers that tolerate stale pi extension contexts.
import type { ExtensionContext, ThemeColor } from "@earendil-works/pi-coding-agent" with {
  "resolution-mode": "import",
};
import { isStaleContextError, logExtensionError } from "../shared/errors.js";
import { describeRanges } from "../shared/format.js";
import { basename } from "node:path";
import { EXT_CONFIG_NAME, readPiConfigStatusDisplay } from "../shared/config.js";
import type { StatusDisplay } from "../shared/config-options.js";
import { toRelativeDisplayPath } from "../shared/paths.js";
import { truncateToWidth, visibleWidth } from "../shared/display-width.js";
import type { PiIdeRuntime } from "./state.js";

const IDE_ICON = "⧉";
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL_MS = 90;
// Pi stores the active theme on globalThis so every module loader sees the same instance.
const PI_THEME_KEYS = [
  Symbol.for("@earendil-works/pi-coding-agent:theme"),
  Symbol.for("@mariozechner/pi-coding-agent:theme"),
] as const;

interface StatusSegment {
  text: string;
  color: ThemeColor;
  shrink?: boolean;
}

type ThemeColorizer = (color: ThemeColor, text: string) => string;

type ActiveUiContext = Pick<ExtensionContext, "cwd" | "ui">;

interface StatuslineSpinnerState {
  frame: number;
  timer?: ReturnType<typeof setInterval>;
  runtime?: PiIdeRuntime;
  ui?: ActiveUiContext;
}

const statuslineSpinner: StatuslineSpinnerState = { frame: 0 };

function getActiveUiContext(ctx: ExtensionContext | undefined): ActiveUiContext | undefined {
  if (!ctx) return undefined;

  try {
    if (!ctx.hasUI) return undefined;
    return { cwd: ctx.cwd, ui: ctx.ui };
  } catch (error) {
    // Stale ctx (post reload/session swap) is an expected signal, not a fault;
    // logging it would spam on every UI refresh. Surface only real failures.
    if (!isStaleContextError(error)) logExtensionError("read active Pi UI context", error);
    return undefined;
  }
}

function runReportingUiFailure(scope: string, action: () => void): void {
  try {
    action();
  } catch (error) {
    logExtensionError(scope, error);
  }
}

export function updateIdeUi(
  runtime: PiIdeRuntime,
  ctx: ExtensionContext | undefined = runtime.ctx,
  statusDisplay?: StatusDisplay,
): void {
  const uiContext = getActiveUiContext(ctx);
  if (!uiContext) return;

  const display =
    statusDisplay ??
    readPiConfigStatusDisplay({
      projectDir: ctx?.cwd ?? runtime.cwd,
    });

  if (display === "statusline") {
    clearWidget(uiContext);
    updateStatusline(runtime, uiContext);
    return;
  }

  stopStatuslineSpinner();
  clearStatusline(uiContext);
  updateWidget(runtime, uiContext);
}

export function clearIdeUi(runtime: PiIdeRuntime, ctx: ExtensionContext | undefined = runtime.ctx): void {
  const uiContext = getActiveUiContext(ctx);
  stopStatuslineSpinner();
  if (!uiContext) return;
  clearWidget(uiContext);
  clearStatusline(uiContext);
}

function updateWidget(runtime: PiIdeRuntime, uiContext: ActiveUiContext): void {
  runReportingUiFailure("update IDE UI widget", () =>
    uiContext.ui.setWidget(
      EXT_CONFIG_NAME,
      (tui, theme) => {
        let frame = 0;
        let timer: ReturnType<typeof setInterval> | undefined;

        // Drive the connecting spinner: tick a frame and request a redraw only while connecting.
        const animate = (active: boolean): void => {
          if (active && !timer) {
            timer = setInterval(() => {
              try {
                frame = (frame + 1) % SPINNER_FRAMES.length;
                tui.requestRender();
              } catch (error) {
                logExtensionError("animate IDE UI widget", error);
                if (timer) {
                  clearInterval(timer);
                  timer = undefined;
                }
              }
            }, SPINNER_INTERVAL_MS);
            timer.unref?.();
          } else if (!active && timer) {
            clearInterval(timer);
            timer = undefined;
          }
        };

        return {
          render(width: number): string[] {
            try {
              const connecting = runtime.enabled && runtime.connectionStatus === "connecting";
              animate(connecting);
              const segments = buildStatusSegments(runtime, SPINNER_FRAMES[frame]);
              if (segments.length === 0 || width <= 0) return [];
              const visible = truncateSegments(segments, width);
              const plainWidth = visible.reduce((sum, segment) => sum + visibleWidth(segment.text), 0);
              const pad = " ".repeat(Math.max(0, width - plainWidth));
              return [pad + visible.map((segment) => theme.fg(segment.color, segment.text)).join("")];
            } catch (error) {
              logExtensionError("render IDE UI widget", error);
              animate(false);
              return [];
            }
          },
          invalidate() {},
          dispose() {
            animate(false);
          },
        };
      },
      { placement: "aboveEditor" },
    ),
  );
}

function updateStatusline(runtime: PiIdeRuntime, uiContext: ActiveUiContext): void {
  statuslineSpinner.runtime = runtime;
  statuslineSpinner.ui = uiContext;

  const connecting = runtime.enabled && runtime.connectionStatus === "connecting";
  if (connecting) {
    startStatuslineSpinner();
  } else {
    stopStatuslineSpinner();
  }

  applyStatusline(runtime, uiContext, SPINNER_FRAMES[statuslineSpinner.frame]);
}

function applyStatusline(runtime: PiIdeRuntime, uiContext: ActiveUiContext, spinnerFrame: string): void {
  runReportingUiFailure("update IDE statusline", () => {
    // Colorize with the same ThemeColor mapping as the above-editor widget so pending/error/dim match.
    const text = buildStatusText(runtime, spinnerFrame, getThemeColorizer());
    uiContext.ui.setStatus(EXT_CONFIG_NAME, text);
  });
}

function startStatuslineSpinner(): void {
  if (statuslineSpinner.timer) return;

  statuslineSpinner.timer = setInterval(() => {
    try {
      statuslineSpinner.frame = (statuslineSpinner.frame + 1) % SPINNER_FRAMES.length;
      const runtime = statuslineSpinner.runtime;
      const ui = statuslineSpinner.ui;
      if (!runtime || !ui) return;
      if (!(runtime.enabled && runtime.connectionStatus === "connecting")) {
        stopStatuslineSpinner();
        applyStatusline(runtime, ui, SPINNER_FRAMES[statuslineSpinner.frame]);
        return;
      }
      applyStatusline(runtime, ui, SPINNER_FRAMES[statuslineSpinner.frame]);
    } catch (error) {
      logExtensionError("animate IDE statusline", error);
      stopStatuslineSpinner();
    }
  }, SPINNER_INTERVAL_MS);
  statuslineSpinner.timer.unref?.();
}

function stopStatuslineSpinner(): void {
  if (!statuslineSpinner.timer) return;
  clearInterval(statuslineSpinner.timer);
  statuslineSpinner.timer = undefined;
}

function clearWidget(uiContext: ActiveUiContext): void {
  runReportingUiFailure("clear IDE UI widget", () => uiContext.ui.setWidget(EXT_CONFIG_NAME, undefined));
}

function clearStatusline(uiContext: ActiveUiContext): void {
  runReportingUiFailure("clear IDE statusline", () => uiContext.ui.setStatus(EXT_CONFIG_NAME, undefined));
}

// Truncates colored segments to the given width, appending an ellipsis when content overflows.
function truncateSegments(segments: StatusSegment[], width: number): StatusSegment[] {
  const total = segments.reduce((sum, segment) => sum + visibleWidth(segment.text), 0);
  if (total <= width) return segments;
  const fallbackColor = segments[0]?.color ?? "dim";
  if (width <= 3) return [{ text: ".".repeat(width), color: fallbackColor }];

  const shrinkIndex = segments.findIndex((segment) => segment.shrink);
  if (shrinkIndex >= 0) {
    const shrinkSegment = segments[shrinkIndex];
    const shrinkWidth = visibleWidth(shrinkSegment.text);
    const reservedWidth = total - shrinkWidth;
    const room = width - reservedWidth;
    if (room > 0) {
      const preserved = segments.map((segment, index) =>
        index === shrinkIndex ? { ...segment, text: truncateToWidth(segment.text, room) } : segment,
      );
      const preservedWidth = preserved.reduce((sum, segment) => sum + visibleWidth(segment.text), 0);
      if (preservedWidth <= width) return preserved;
    }
  }

  const ellipsis = "...";
  const limit = width - visibleWidth(ellipsis);
  const visible: StatusSegment[] = [];
  let used = 0;
  for (const segment of segments) {
    if (used >= limit) break;
    const room = limit - used;
    const segmentWidth = visibleWidth(segment.text);
    if (segmentWidth <= room) {
      visible.push(segment);
      used += segmentWidth;
    } else {
      const text = truncateToWidth(segment.text, room, "");
      if (text) visible.push({ text, color: segment.color });
      break;
    }
  }
  visible.push({ text: ellipsis, color: visible[visible.length - 1]?.color ?? fallbackColor });
  return visible;
}

export function buildStatusSegments(runtime: PiIdeRuntime, spinnerFrame = SPINNER_FRAMES[0]): StatusSegment[] {
  if (!runtime.enabled) return [];

  switch (runtime.connectionStatus) {
    case "connecting":
      return [{ text: `${IDE_ICON} ${spinnerFrame}`, color: "dim" }];
    case "error":
      return [
        { text: `${IDE_ICON} `, color: "dim" },
        { text: "✕", color: "error" },
      ];
    case "connected":
      return buildConnectedSegments(runtime);
    default:
      return [];
  }
}

export function buildStatusText(
  runtime: PiIdeRuntime,
  spinnerFrame = SPINNER_FRAMES[0],
  colorize?: ThemeColorizer,
): string | undefined {
  const segments = buildStatusSegments(runtime, spinnerFrame);
  if (segments.length === 0) return undefined;
  return formatStatusSegments(segments, colorize);
}

export function formatStatusSegments(segments: StatusSegment[], colorize?: ThemeColorizer): string {
  if (!colorize) return segments.map((segment) => segment.text).join("");
  return segments.map((segment) => colorize(segment.color, segment.text)).join("");
}

function getThemeColorizer(): ThemeColorizer | undefined {
  const activeTheme = getActivePiTheme();
  if (!activeTheme) return undefined;
  return (color, text) => activeTheme.fg(color, text);
}

function getActivePiTheme(): { fg: (color: ThemeColor, text: string) => string } | undefined {
  const globalStore = globalThis as Record<symbol, unknown>;
  for (const key of PI_THEME_KEYS) {
    const candidate = globalStore[key];
    if (!isThemeLike(candidate)) continue;
    return candidate;
  }
  return undefined;
}

function isThemeLike(value: unknown): value is { fg: (color: ThemeColor, text: string) => string } {
  if (!value || typeof value !== "object") return false;
  return typeof (value as { fg?: unknown }).fg === "function";
}

function buildConnectedSegments(runtime: PiIdeRuntime): StatusSegment[] {
  const selection = runtime.latestSelection;
  if (!selection) return [{ text: `${IDE_ICON} ✓`, color: "dim" }];

  const rel = basename(selection.filePath);
  const range = describeRanges(selection.ranges);
  // Pending selections are still queued for the next prompt (⇡, success); sent ones are attached (✓, dim).
  const pending = runtime.attachState === "pending";
  const marker = pending ? "⇡" : "✓";
  const color: ThemeColor = pending ? "success" : "dim";
  const prefix = `${IDE_ICON} ${marker} `;
  if (range === "open file") return [{ text: `${prefix}${rel}`, color, shrink: true }];
  return [
    { text: prefix, color },
    { text: rel, color, shrink: true },
    { text: range, color },
  ];
}

export function buildWidget(runtime: PiIdeRuntime, cwd?: string): string[] | undefined {
  if (!runtime.enabled || runtime.connectionStatus === "disabled") return undefined;
  if (
    runtime.connectionStatus !== "connected" &&
    runtime.connectionStatus !== "connecting" &&
    runtime.connectionStatus !== "error"
  ) {
    return undefined;
  }

  const lines: string[] = [];
  const ide = runtime.connectedServer?.name ?? runtime.currentCandidate?.lock.name ?? "IDE";
  lines.push(`IDE: ${ide} (${runtime.connectionStatus})`);

  if (runtime.currentCandidate) {
    lines.push(`Workspace: ${runtime.currentCandidate.workspaceFolder}`);
  }

  if (runtime.latestSelection) {
    const selection = runtime.latestSelection;
    lines.push(`File: ${toRelativeDisplayPath(selection.filePath, selection.workspaceFolder, cwd)}`);
    lines.push(`Range: ${describeRanges(selection.ranges)}`);
    lines.push(`Attach: ${runtime.attachState}`);
    if (selection.receivedAt) lines.push(`Updated: ${new Date(selection.receivedAt).toLocaleTimeString()}`);
  } else if (runtime.connectionMessage) {
    lines.push(runtime.connectionMessage);
  }

  return lines;
}
