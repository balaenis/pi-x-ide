import type { ExtensionContext } from "@earendil-works/pi-coding-agent" with { "resolution-mode": "import" };
import type { AttachState, EditorSelectionSnapshot, LockFileCandidate } from "../shared/protocol";
import type { IdeConnection } from "./connection";

export interface PiIdeRuntime {
  ctx?: ExtensionContext;
  cwd?: string;
  enabled: boolean;
  connection?: IdeConnection;
  currentCandidate?: LockFileCandidate;
  candidates: LockFileCandidate[];
  connectedServer?: { name: string; version?: string; ide?: string };
  connectionStatus: "idle" | "connecting" | "connected" | "disconnected" | "error" | "disabled";
  connectionMessage?: string;
  latestSelection?: EditorSelectionSnapshot;
  latestSelectionKey?: string;
  attachState: AttachState;
  turnSelection?: EditorSelectionSnapshot;
  reconnectTimer?: NodeJS.Timeout;
}

export function createRuntime(): PiIdeRuntime {
  return {
    enabled: true,
    candidates: [],
    connectionStatus: "idle",
    attachState: "idle",
  };
}
