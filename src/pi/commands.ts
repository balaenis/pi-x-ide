// ABOUTME: Registers the /ide command and selection attach shortcut for pi-x-ide.
// ABOUTME: Routes user actions through safe Pi boundaries before calling IDE integration actions.
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent" with {
  "resolution-mode": "import",
};
import { resolvePiConfigEnv } from "../shared/config.js";
import { formatRangeMention } from "../shared/format.js";
import type { LockFileCandidate } from "../shared/protocol.js";
import { showIdeSettings } from "./config-ui.js";
import type { PiIdeRuntime } from "./state.js";
import { runPiBoundary, runPiBoundaryAsync } from "./safety.js";
import { buildWidget, updateIdeUi } from "./ui.js";

export const PI_X_IDE_ATTACH_SHORTCUT_ENV = "PI_X_IDE_ATTACH_SHORTCUT";
export const DEFAULT_ATTACH_SHORTCUT = "ctrl+alt+k";

const DISABLED_ATTACH_SHORTCUT_VALUES = new Set(["", "0", "false", "off", "none", "disabled"]);

type ShortcutKey = Parameters<ExtensionAPI["registerShortcut"]>[0];

export interface IdeCommandActions {
  refreshCandidates: (ctx: ExtensionCommandContext) => Promise<LockFileCandidate[]>;
  connectAuto: (ctx: ExtensionCommandContext) => Promise<void>;
  connectCandidate: (candidate: LockFileCandidate, ctx: ExtensionCommandContext) => Promise<void>;
  disconnect: (ctx: ExtensionCommandContext, disabled?: boolean) => void;
  installExtension: (ctx: ExtensionCommandContext) => Promise<void>;
}

export function registerIdeCommand(
  pi: ExtensionAPI,
  runtime: PiIdeRuntime,
  actions: IdeCommandActions,
  options: { env?: NodeJS.ProcessEnv } = {},
): void {
  const attachShortcut = resolveAttachShortcut(options.env);
  if (attachShortcut) {
    pi.registerShortcut(attachShortcut, {
      description: "Attach latest IDE selection to the prompt",
      handler: (ctx) => {
        runPiBoundary(
          "IDE attach shortcut",
          runtime,
          () => {
            runtime.ctx = ctx;
            attachLatest(runtime, ctx);
          },
          ctx,
        );
      },
    });
  }

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
        { value: "settings", label: "settings", description: "Open IDE settings (Display, AutoInstall, ...)" },
      ];
      const filtered = subcommands.filter((s) => s.value.startsWith(argumentPrefix));
      return filtered.length > 0 ? filtered : null;
    },
    handler: (args, ctx) =>
      runPiBoundaryAsync(
        "/ide command",
        runtime,
        async () => {
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
            case "settings":
              await showIdeSettings(runtime, ctx);
              return;
            default:
              ctx.ui.notify("Usage: /ide [status|list|auto|off|attach|install|settings]", "warning");
          }
        },
        ctx,
      ),
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

export function resolveAttachShortcut(env: NodeJS.ProcessEnv = process.env): ShortcutKey | undefined {
  const value = resolvePiConfigEnv(env)[PI_X_IDE_ATTACH_SHORTCUT_ENV] ?? DEFAULT_ATTACH_SHORTCUT;
  const normalized = value.trim().toLowerCase();
  if (DISABLED_ATTACH_SHORTCUT_VALUES.has(normalized)) return undefined;
  return normalized as ShortcutKey;
}

function attachLatest(runtime: PiIdeRuntime, ctx: ExtensionContext): void {
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
