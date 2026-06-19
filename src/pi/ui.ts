// ABOUTME: Renders pi-x-ide's TUI status widget for IDE connection state.
// ABOUTME: Provides safe UI update helpers that tolerate stale pi extension contexts.
import type { ExtensionContext, ThemeColor } from "@earendil-works/pi-coding-agent" with {
  "resolution-mode": "import",
};
import { logExtensionError } from "../shared/errors";
import { describeRanges } from "../shared/format";
import { toRelativeDisplayPath } from "../shared/paths";
import type { PiIdeRuntime } from "./state";

const IDE_ICON = "⧉";
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL_MS = 90;

interface StatusSegment {
  text: string;
  color: ThemeColor;
}

type ActiveUiContext = Pick<ExtensionContext, "cwd" | "ui">;

function getActiveUiContext(ctx: ExtensionContext | undefined): ActiveUiContext | undefined {
  if (!ctx) return undefined;

  try {
    if (!ctx.hasUI) return undefined;
    return { cwd: ctx.cwd, ui: ctx.ui };
  } catch (error) {
    logExtensionError("read active Pi UI context", error);
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

export function updateIdeUi(runtime: PiIdeRuntime, ctx: ExtensionContext | undefined = runtime.ctx): void {
  const uiContext = getActiveUiContext(ctx);
  if (!uiContext) return;

  runReportingUiFailure("update IDE UI widget", () =>
    uiContext.ui.setWidget(
      "pi-x-ide",
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
              const segments = buildStatusSegments(runtime, uiContext.cwd, SPINNER_FRAMES[frame]);
              if (segments.length === 0 || width <= 0) return [];
              const visible = truncateSegments(segments, width);
              const plainLength = visible.reduce((sum, segment) => sum + segment.text.length, 0);
              const pad = " ".repeat(Math.max(0, width - plainLength));
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

export function clearIdeUi(runtime: PiIdeRuntime, ctx: ExtensionContext | undefined = runtime.ctx): void {
  const uiContext = getActiveUiContext(ctx);
  if (!uiContext) return;
  runReportingUiFailure("clear IDE UI widget", () => uiContext.ui.setWidget("pi-x-ide", undefined));
}

// Truncates colored segments to the given width, appending an ellipsis when content overflows.
function truncateSegments(segments: StatusSegment[], width: number): StatusSegment[] {
  const total = segments.reduce((sum, segment) => sum + segment.text.length, 0);
  if (total <= width) return segments;
  const fallbackColor = segments[0]?.color ?? "dim";
  if (width <= 3) return [{ text: ".".repeat(width), color: fallbackColor }];

  const limit = width - 3;
  const visible: StatusSegment[] = [];
  let used = 0;
  for (const segment of segments) {
    if (used >= limit) break;
    const room = limit - used;
    if (segment.text.length <= room) {
      visible.push(segment);
      used += segment.text.length;
    } else {
      visible.push({ text: segment.text.slice(0, room), color: segment.color });
      used = limit;
    }
  }
  visible.push({ text: "...", color: visible[visible.length - 1]?.color ?? fallbackColor });
  return visible;
}

export function buildStatusSegments(
  runtime: PiIdeRuntime,
  cwd?: string,
  spinnerFrame = SPINNER_FRAMES[0],
): StatusSegment[] {
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
      return buildConnectedSegments(runtime, cwd);
    default:
      return [];
  }
}

function buildConnectedSegments(runtime: PiIdeRuntime, cwd?: string): StatusSegment[] {
  const selection = runtime.latestSelection;
  if (!selection) return [{ text: `${IDE_ICON} ✓`, color: "dim" }];

  const rel = toRelativeDisplayPath(selection.filePath, selection.workspaceFolder, cwd);
  const range = describeRanges(selection.ranges);
  // Pending selections are still queued for the next prompt (⇡, success); sent ones are attached (✓, dim).
  const pending = runtime.attachState === "pending";
  const marker = pending ? "⇡" : "✓";
  const color: ThemeColor = pending ? "success" : "dim";
  return [{ text: `${IDE_ICON} ${marker} ${rel}${range === "open file" ? "" : range}`, color }];
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
