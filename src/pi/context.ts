import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { formatEditorContext, snapshotKey } from "../shared/format";
import type { EditorSelectionSnapshot } from "../shared/protocol";
import type { PiIdeRuntime } from "./state";
import { updateIdeUi } from "./ui";

const CONTEXT_MARKER = "pi-x-ide/editor-context";

export function registerContextHandlers(pi: ExtensionAPI, runtime: PiIdeRuntime): void {
  pi.on("before_agent_start", async (_event, ctx) => {
    runtime.ctx = ctx;
    if (!runtime.enabled) return;
    if (!runtime.latestSelection) return;
    if (runtime.attachState !== "pending") return;
    runtime.turnSelection = runtime.latestSelection;
  });

  // The runtime supports the documented `context` event, but the top-level package
  // does not currently export all helper result/message types. Keep the cast local.
  (pi.on as any)("context", async (event: { messages: unknown[] }, ctx: ExtensionContext) => {
    runtime.ctx = ctx;
    if (!runtime.enabled || !runtime.turnSelection) return;
    if (messagesContainMarker(event.messages)) return;

    const text = `${formatEditorContext(runtime.turnSelection, { cwd: ctx.cwd })}\n<!-- ${CONTEXT_MARKER} -->`;
    const editorContextMessage = {
      role: "user",
      content: [{ type: "text", text }],
      timestamp: Date.now(),
    };
    return {
      messages: [...event.messages, editorContextMessage],
    };
  });

  pi.on("agent_end", async (_event, ctx) => {
    runtime.ctx = ctx;
    if (runtime.turnSelection) {
      runtime.attachState = "sent";
      runtime.turnSelection = undefined;
      updateIdeUi(runtime, ctx);
    }
  });
}

export function setLatestSelection(runtime: PiIdeRuntime, snapshot: EditorSelectionSnapshot, ctx?: ExtensionContext): void {
  const key = snapshotKey(snapshot);
  runtime.latestSelection = snapshot;
  if (runtime.latestSelectionKey !== key) {
    runtime.latestSelectionKey = key;
    runtime.attachState = "pending";
  }
  updateIdeUi(runtime, ctx);
}

function messagesContainMarker(messages: unknown[]): boolean {
  return messages.some((message) => JSON.stringify(message).includes(CONTEXT_MARKER));
}
