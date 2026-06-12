import type { ExtensionContext } from "@earendil-works/pi-coding-agent" with { "resolution-mode": "import" };
import { describeRanges } from "../shared/format";
import { toRelativeDisplayPath } from "../shared/paths";
import type { PiIdeRuntime } from "./state";

export function updateIdeUi(runtime: PiIdeRuntime, ctx: ExtensionContext | undefined = runtime.ctx): void {
  if (!ctx?.hasUI) return;

  ctx.ui.setWidget(
    "pi-x-ide",
    (_tui, theme) => ({
      render(width: number): string[] {
        const status = buildStatusLine(runtime, ctx.cwd);
        const text = truncatePlainStatus(status, width);
        const pad = " ".repeat(Math.max(0, width - text.length));
        const color = isPendingEditorContext(runtime) ? "success" : "dim";
        return [pad + theme.fg(color, text)];
      },
      invalidate() {},
    }),
    { placement: "aboveEditor" },
  );
}

export function clearIdeUi(runtime: PiIdeRuntime, ctx: ExtensionContext | undefined = runtime.ctx): void {
  if (!ctx?.hasUI) return;
  ctx.ui.setWidget("pi-x-ide", undefined);
}

function truncatePlainStatus(text: string, width: number): string {
  if (width <= 0) return "";
  if (text.length <= width) return text;
  if (width <= 3) return ".".repeat(width);
  return `${text.slice(0, width - 3)}...`;
}

function isPendingEditorContext(runtime: PiIdeRuntime): boolean {
  return !!runtime.latestSelection && runtime.attachState === "pending";
}

export function buildStatusLine(runtime: PiIdeRuntime, cwd?: string): string {
  if (!runtime.enabled || runtime.connectionStatus === "disabled") return "Pi x IDE: off";
  if (runtime.connectionStatus === "connecting") return "Pi x IDE: connecting";
  if (runtime.connectionStatus === "error")
    return `Pi x IDE: error${runtime.connectionMessage ? ` ${runtime.connectionMessage}` : ""}`;
  if (runtime.connectionStatus !== "connected") return "Pi x IDE: disconnected";

  const ide = runtime.connectedServer?.ide ?? runtime.currentCandidate?.lock.ide ?? "ide";
  const selection = runtime.latestSelection;
  if (!selection) return `${ide} ✓`;
  const rel = toRelativeDisplayPath(selection.filePath, selection.workspaceFolder, cwd);
  const range = describeRanges(selection.ranges);
  return `${ide} ✓ ${rel}${range === "open file" ? "" : range} ${runtime.attachState}`;
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
