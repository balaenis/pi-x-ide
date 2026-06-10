import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent" with {
  "resolution-mode": "import",
};
import { formatRangeMention } from "../shared/format";
import type { LockFileCandidate } from "../shared/protocol";
import type { PiIdeRuntime } from "./state";
import { buildWidget, updateIdeUi } from "./ui";

export interface IdeCommandActions {
  refreshCandidates: (ctx: ExtensionCommandContext) => Promise<LockFileCandidate[]>;
  connectAuto: (ctx: ExtensionCommandContext) => Promise<void>;
  connectCandidate: (candidate: LockFileCandidate, ctx: ExtensionCommandContext) => Promise<void>;
  disconnect: (ctx: ExtensionCommandContext, disabled?: boolean) => void;
  installExtension: (ctx: ExtensionCommandContext) => Promise<void>;
}

export function registerIdeCommand(pi: ExtensionAPI, runtime: PiIdeRuntime, actions: IdeCommandActions): void {
  pi.registerCommand("ide", {
    description: "Manage IDE connection and editor selection context",
    getArgumentCompletions: (argumentPrefix: string) => {
      const subcommands = [
        { value: "status", label: "status", description: "Show IDE connection status" },
        { value: "list", label: "list", description: "List available IDE connections" },
        { value: "auto", label: "auto", description: "Auto-connect to the most recent IDE" },
        { value: "off", label: "off", description: "Disable IDE integration" },
        { value: "attach", label: "attach", description: "Attach latest IDE selection to the prompt" },
        { value: "install", label: "install", description: "Install or update the IDE extension" },
      ];
      const filtered = subcommands.filter((s) => s.value.startsWith(argumentPrefix));
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args, ctx) => {
      runtime.ctx = ctx;
      const [subcommand] = args.trim().split(/\s+/, 1);
      switch (subcommand || "") {
        case "":
          await showPicker(runtime, actions, ctx);
          return;
        case "status":
          showStatus(runtime, ctx);
          return;
        case "list":
          await listCandidates(actions, ctx);
          return;
        case "auto":
          runtime.enabled = true;
          await actions.connectAuto(ctx);
          return;
        case "off":
          actions.disconnect(ctx, true);
          return;
        case "attach":
          attachLatest(runtime, ctx);
          return;
        case "install":
          await actions.installExtension(ctx);
          return;
        default:
          ctx.ui.notify("Usage: /ide [status|list|auto|off|attach|install]", "warning");
      }
    },
  });
}

async function showPicker(
  runtime: PiIdeRuntime,
  actions: IdeCommandActions,
  ctx: ExtensionCommandContext,
): Promise<void> {
  const candidates = await actions.refreshCandidates(ctx);
  if (candidates.length === 0) {
    ctx.ui.notify("No matching IDE connections found.", "warning");
    return;
  }

  const labels = candidates.map(
    (candidate, index) => `${index + 1}. ${candidate.lock.name} — ${candidate.workspaceFolder}`,
  );
  labels.push("Disable IDE integration");
  const choice = await ctx.ui.select("Select IDE connection", labels);
  if (!choice) return;
  if (choice === "Disable IDE integration") {
    actions.disconnect(ctx, true);
    return;
  }

  const index = labels.indexOf(choice);
  const candidate = candidates[index];
  if (candidate) {
    runtime.enabled = true;
    await actions.connectCandidate(candidate, ctx);
  }
}

function showStatus(runtime: PiIdeRuntime, ctx: ExtensionCommandContext): void {
  const lines = buildWidget(runtime, ctx.cwd) ?? ["IDE: disconnected"];
  ctx.ui.notify(lines.join("\n"), runtime.connectionStatus === "error" ? "error" : "info");
}

async function listCandidates(actions: IdeCommandActions, ctx: ExtensionCommandContext): Promise<void> {
  const candidates = await actions.refreshCandidates(ctx);
  if (candidates.length === 0) {
    ctx.ui.notify("No matching IDE lock files found.", "info");
    return;
  }
  ctx.ui.notify(
    candidates
      .map(
        (candidate, index) =>
          `${index + 1}. ${candidate.lock.name} ${candidate.lock.host}:${candidate.lock.port}\n   ${candidate.workspaceFolder}\n   ${candidate.path}`,
      )
      .join("\n"),
    "info",
  );
}

function attachLatest(runtime: PiIdeRuntime, ctx: ExtensionCommandContext): void {
  if (!runtime.latestSelection) {
    ctx.ui.notify("No IDE selection is available.", "warning");
    return;
  }
  const mention = formatRangeMention(runtime.latestSelection, { cwd: ctx.cwd });
  ctx.ui.pasteToEditor(mention);
  runtime.attachState = "pending";
  updateIdeUi(runtime, ctx);
  ctx.ui.notify(`Attached ${mention}`, "info");
}
