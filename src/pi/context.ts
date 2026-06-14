import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent" with {
  "resolution-mode": "import",
};
import { formatEditorContext, snapshotKey } from "../shared/format";
import type { EditorSelectionSnapshot } from "../shared/protocol";
import { DIAGNOSTIC_CONTEXT_MARKER } from "./diagnostics";
import type { PiIdeRuntime } from "./state";
import { updateIdeUi } from "./ui";

const CONTEXT_MARKER = "pi-x-ide/editor-context";

export function registerContextHandlers(pi: ExtensionAPI, runtime: PiIdeRuntime): void {
  pi.on("before_agent_start", (_event, ctx) => {
    runtime.ctx = ctx;
    if (!runtime.enabled) return;
    if (!runtime.latestSelection) return;
    if (runtime.attachState !== "pending") return;

    runtime.turnSelection = runtime.latestSelection;
  });

  // Merge the active editor context into the submitted user prompt rather than
  // adding a separate extension message.
  pi.on("message_end", (event, ctx) => {
    runtime.ctx = ctx;
    if (!runtime.enabled || !runtime.turnSelection) return;
    if (event.message.role !== "user") return;
    if (messageContainsMarker(event.message)) {
      runtime.turnSelection = undefined;
      return;
    }

    const text = `${formatEditorContext(runtime.turnSelection, { cwd: ctx.cwd })}\n<!-- ${CONTEXT_MARKER} -->\n`;
    const message = mergeIntoUserMessage(event.message, text);
    runtime.attachState = "sent";
    runtime.turnSelection = undefined;
    updateIdeUi(runtime, ctx);
    return { message };
  });
}

export function setLatestSelection(
  runtime: PiIdeRuntime,
  snapshot: EditorSelectionSnapshot,
  ctx?: ExtensionContext,
): void {
  const key = snapshotKey(snapshot);
  runtime.latestSelection = snapshot;
  if (runtime.latestSelectionKey !== key) {
    runtime.latestSelectionKey = key;
    runtime.attachState = "pending";
  }
  updateIdeUi(runtime, ctx);
}

export function clearLatestSelection(runtime: PiIdeRuntime, ctx?: ExtensionContext): void {
  runtime.latestSelection = undefined;
  runtime.latestSelectionKey = undefined;
  runtime.turnSelection = undefined;
  runtime.attachState = "idle";
  updateIdeUi(runtime, ctx);
}

type UserContentBlock =
  | { type: "text"; text: string; textSignature?: string }
  | { type: "image"; data: string; mimeType: string };

type MergeableUserMessage = {
  role: "user";
  content: string | UserContentBlock[];
};

function mergeIntoUserMessage<T extends MergeableUserMessage>(message: T, text: string): T {
  return {
    ...message,
    content: [{ type: "text", text }, ...normalizeUserContent(message.content)],
  };
}

function normalizeUserContent(content: MergeableUserMessage["content"]): UserContentBlock[] {
  return typeof content === "string" ? [{ type: "text", text: content }] : content;
}

function messageContainsMarker(message: MergeableUserMessage): boolean {
  const serialized = JSON.stringify(message);
  return serialized.includes(CONTEXT_MARKER) || serialized.includes(DIAGNOSTIC_CONTEXT_MARKER);
}
