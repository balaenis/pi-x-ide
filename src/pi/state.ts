// ABOUTME: Defines the mutable Pi-side runtime state for IDE connection sessions.
// ABOUTME: Tracks candidates, selection, reconnect/Zed fiber handles, and session generation.
import type { ExtensionContext } from "@earendil-works/pi-coding-agent" with { "resolution-mode": "import" };
import type { RuntimeFiber } from "effect/Fiber";
import type { AttachState, EditorSelectionSnapshot, LockFileCandidate } from "../shared/protocol.js";
import type { IdeConnection } from "./connection.js";

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
  reconnectFiber?: RuntimeFiber<void, never>;
  reconnectAttempts: number;
  reconnectCandidateKey?: string;
  zedPollFiber?: RuntimeFiber<void, never>;
  zedPollSelectionKey?: string;
  zedPollWalMtimeMs?: number;
  /** Last resolved Zed poll interval (ms); set while polling for observability/tests. */
  zedPollIntervalMs?: number;
  installingIdeIds: Set<string>;
  sessionGeneration: number;
  /** True while the current session_start handler is in progress (not factory preload). */
  sessionStarting: boolean;
  /** In-flight session startup task; shutdown awaits this when present. */
  startupTask?: Promise<void>;
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
    sessionStarting: false,
  };
}
