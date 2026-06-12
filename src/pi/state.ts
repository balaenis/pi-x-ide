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
  reconnectAttempts: number;
  reconnectCandidateKey?: string;
  zedPollTimer?: NodeJS.Timeout;
  zedPollSelectionKey?: string;
  zedPollWalMtimeMs?: number;
  installingIdeIds: Set<string>;
  sessionGeneration: number;
}

export function createRuntime(): PiIdeRuntime {
  return {
    enabled: true,
    candidates: [],
    connectionStatus: "idle",
    attachState: "idle",
    reconnectAttempts: 0,
    installingIdeIds: new Set<string>(),
    sessionGeneration: 0,
  };
}
