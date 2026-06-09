import type { ExtensionContext } from "@earendil-works/pi-coding-agent" with { "resolution-mode": "import" };
import { describeRanges } from "../shared/format";
import { toRelativeDisplayPath } from "../shared/paths";
import type { PiIdeRuntime } from "./state";

export function updateIdeUi(runtime: PiIdeRuntime, ctx: ExtensionContext | undefined = runtime.ctx): void {
  if (!ctx?.hasUI) return;

  const status = buildStatusLine(runtime, ctx.cwd);
  ctx.ui.setStatus("pi-x-ide", status);

  const widget = buildWidget(runtime, ctx.cwd);
  ctx.ui.setWidget("pi-x-ide", widget, { placement: "belowEditor" });
}

export function clearIdeUi(runtime: PiIdeRuntime, ctx: ExtensionContext | undefined = runtime.ctx): void {
  if (!ctx?.hasUI) return;
  ctx.ui.setStatus("pi-x-ide", undefined);
  ctx.ui.setWidget("pi-x-ide", undefined);
}

export function buildStatusLine(runtime: PiIdeRuntime, cwd?: string): string {
  if (!runtime.enabled || runtime.connectionStatus === "disabled") return "IDE: off";
  if (runtime.connectionStatus === "connecting") return "IDE: connecting";
  if (runtime.connectionStatus === "error")
    return `IDE: error${runtime.connectionMessage ? ` ${runtime.connectionMessage}` : ""}`;
  if (runtime.connectionStatus !== "connected") return "IDE: disconnected";

  const ide = runtime.connectedServer?.ide ?? runtime.currentCandidate?.lock.ide ?? "ide";
  const selection = runtime.latestSelection;
  if (!selection) return `IDE: ${ide} ✓`;
  const rel = toRelativeDisplayPath(selection.filePath, selection.workspaceFolder, cwd);
  const range = describeRanges(selection.ranges);
  return `IDE: ${ide} ✓ ${rel}${range === "open file" ? "" : range} ${runtime.attachState}`;
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
