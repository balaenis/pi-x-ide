// ABOUTME: Shared diagnostic-fix custom message type constants and detail shapes.
// ABOUTME: Keeps heavy runtime free of pi-tui imports used only by the message renderer.
import type { DiagnosticFixRequestedParams, IdeDiagnostic, Position } from "../shared/protocol.js";

export const DIAGNOSTIC_FIX_CUSTOM_TYPE = "pi-x-ide/diagnostic-fix";

export interface DiagnosticFixDetails {
  source: DiagnosticFixRequestedParams["source"];
  filePath: string;
  workspaceFolder?: string;
  triggerRange: { start: Position; end: Position };
  diagnostics: IdeDiagnostic[];
  cwd?: string;
}
