// ABOUTME: Discovers and installs companion IDE extensions for supported editors.
// ABOUTME: Detects editor CLIs, compares installed versions, and runs extension installation commands.
import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { resolvePiConfigEnv } from "../shared/config.js";
import { PI_X_IDE_VERSION } from "../shared/version.js";
import type { PiIdeRuntime } from "./state.js";

const execFileAsync = promisify(execFile);

export const PI_X_IDE_EXTENSION_ID = "balaenis.pi-x-ide";
export const PI_X_IDE_AUTO_INSTALL_ENV = "PI_X_IDE_AUTO_INSTALL";
export const PI_X_IDE_TARGET_VERSION = PI_X_IDE_VERSION;

export type SupportedIdeId = "vscode" | "cursor" | "windsurf";
export type IdeInstallConfidence = "current-terminal" | "running-process" | "available-cli";
export type IdeInstallReason = "missing" | "outdated" | "current" | "unknown";
export type VersionComparison = "older" | "equal" | "newer" | "unknown";

export interface IdeCliProfile {
  id: SupportedIdeId;
  label: string;
  command: "code" | "cursor" | "windsurf";
}

export interface IdeInstallCandidate {
  id: SupportedIdeId;
  label: string;
  cli: IdeCliProfile["command"];
  cliPath: string;
  confidence: IdeInstallConfidence;
  installedVersion?: string;
  targetVersion: string;
  needsInstall: boolean;
  reason: IdeInstallReason;
  listError?: string;
}

export interface IdeInstallResult {
  candidate: IdeInstallCandidate;
  skipped: boolean;
  success: boolean;
  stdout: string;
  stderr: string;
  error?: string;
}

export interface DiscoverInstallCandidatesOptions {
  env?: NodeJS.ProcessEnv;
  includeLowConfidence?: boolean;
  timeoutMs?: number;
}

export interface InstallIdeExtensionOptions {
  timeoutMs?: number;
}

export const SUPPORTED_IDE_CLI_PROFILES: IdeCliProfile[] = [
  { id: "vscode", label: "VS Code", command: "code" },
  { id: "cursor", label: "Cursor", command: "cursor" },
  { id: "windsurf", label: "Windsurf", command: "windsurf" },
];

export function isAutoInstallEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const configuredEnv = resolvePiConfigEnv(env);
  const value = configuredEnv[PI_X_IDE_AUTO_INSTALL_ENV];
  if (value === undefined) return true;
  return !["0", "false", "off"].includes(value.trim().toLowerCase());
}

export function parseInstalledExtensionVersion(
  output: string,
  extensionId = PI_X_IDE_EXTENSION_ID,
): string | undefined {
  const target = extensionId.toLowerCase();
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const separatorIndex = line.lastIndexOf("@");
    if (separatorIndex <= 0) continue;
    const id = line.slice(0, separatorIndex).toLowerCase();
    if (id === target) return line.slice(separatorIndex + 1).trim() || undefined;
  }
  return undefined;
}

export function compareExtensionVersions(installed: string | undefined, target: string): VersionComparison {
  if (!installed) return "unknown";
  const installedParts = parseStableVersion(installed);
  const targetParts = parseStableVersion(target);
  if (!installedParts || !targetParts) return "unknown";

  for (let index = 0; index < 3; index += 1) {
    if (installedParts[index] < targetParts[index]) return "older";
    if (installedParts[index] > targetParts[index]) return "newer";
  }
  return "equal";
}

export function inferCurrentIdeFromEnv(env: NodeJS.ProcessEnv = process.env): SupportedIdeId | undefined {
  const configuredEnv = resolvePiConfigEnv(env);
  const matches = new Set<SupportedIdeId>();
  const hasWindsurfMarker = hasWindsurfEnvMarker(configuredEnv);
  const hasCursorMarker = hasCursorEnvMarker(configuredEnv);
  const hasVscodeMarker = hasVscodeEnvMarker(configuredEnv);

  if (hasWindsurfMarker) matches.add("windsurf");
  if (hasCursorMarker) matches.add("cursor");
  if (hasVscodeMarker && !hasWindsurfMarker && !hasCursorMarker) matches.add("vscode");

  return matches.size === 1 ? [...matches][0] : undefined;
}

function hasWindsurfEnvMarker(env: NodeJS.ProcessEnv): boolean {
  if (env.TERM_PROGRAM?.toLowerCase() === "windsurf") return true;
  if (hasEnvKey(env, [/^WINDSURF/, /^CODEIUM/])) return true;
  return idePathHints(env).some((value) => envValueMatches(value, [/WINDSURF/, /CODEIUM/]));
}

function hasCursorEnvMarker(env: NodeJS.ProcessEnv): boolean {
  if (env.TERM_PROGRAM?.toLowerCase() === "cursor") return true;
  if (hasEnvKey(env, [/^CURSOR/])) return true;
  return idePathHints(env).some((value) => envValueMatches(value, [/CURSOR/]));
}

function hasVscodeEnvMarker(env: NodeJS.ProcessEnv): boolean {
  if (env.TERM_PROGRAM?.toLowerCase() === "vscode") return true;
  return Boolean(env.VSCODE_CWD || env.VSCODE_PID || env.VSCODE_IPC_HOOK_CLI || env.VSCODE_GIT_IPC_HANDLE);
}

function hasEnvKey(env: NodeJS.ProcessEnv, patterns: RegExp[]): boolean {
  return Object.keys(env).some((key) => patterns.some((pattern) => pattern.test(key.toUpperCase())));
}

function idePathHints(env: NodeJS.ProcessEnv): Array<string | undefined> {
  return [env.VSCODE_CWD, env.VSCODE_IPC_HOOK_CLI, env.VSCODE_GIT_IPC_HANDLE];
}

function envValueMatches(value: string | undefined, patterns: RegExp[]): boolean {
  const upperValue = value?.toUpperCase();
  return upperValue ? patterns.some((pattern) => pattern.test(upperValue)) : false;
}

export function buildInstallArgs(): string[] {
  return ["--force", "--install-extension", PI_X_IDE_EXTENSION_ID];
}

export async function findExecutable(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> {
  const configuredEnv = resolvePiConfigEnv(env);
  const pathEnv = configuredEnv.PATH ?? configuredEnv.Path ?? configuredEnv.path;
  if (!pathEnv) return undefined;

  const extensions = process.platform === "win32" ? parsePathExt(configuredEnv) : [""];
  const candidates = isAbsolute(command)
    ? [command]
    : pathEnv
        .split(delimiter)
        .filter(Boolean)
        .flatMap((directory) => extensions.map((extension) => join(directory, withExtension(command, extension))));

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Keep searching PATH.
    }
  }
  return undefined;
}

export async function runCli(
  cliPath: string,
  args: string[],
  timeoutMs = 15_000,
): Promise<{ stdout: string; stderr: string }> {
  if (process.platform === "win32" && isCmdOrBatFile(cliPath)) {
    const { stdout, stderr } = await execFileAsync(resolveCmdExe(), ["/d", "/c", cliPath, ...args], {
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
    return { stdout: String(stdout), stderr: String(stderr) };
  }
  const { stdout, stderr } = await execFileAsync(cliPath, args, {
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  return { stdout: String(stdout), stderr: String(stderr) };
}

export async function discoverInstallCandidates(
  options: DiscoverInstallCandidatesOptions = {},
): Promise<IdeInstallCandidate[]> {
  const env = resolvePiConfigEnv(options.env ?? process.env);
  const currentIde = inferCurrentIdeFromEnv(env);
  const includeLowConfidence = options.includeLowConfidence ?? false;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const candidates: IdeInstallCandidate[] = [];

  for (const profile of SUPPORTED_IDE_CLI_PROFILES) {
    const cliPath = await findExecutable(profile.command, env);
    if (!cliPath) continue;

    const confidence: IdeInstallConfidence = currentIde === profile.id ? "current-terminal" : "available-cli";
    if (confidence !== "current-terminal" && !includeLowConfidence) continue;

    let installedVersion: string | undefined;
    let listError: string | undefined;
    try {
      const { stdout } = await runCli(cliPath, ["--list-extensions", "--show-versions"], timeoutMs);
      installedVersion = parseInstalledExtensionVersion(stdout);
    } catch (error) {
      listError = error instanceof Error ? error.message : String(error);
    }

    const reason = resolveInstallReason(installedVersion, PI_X_IDE_TARGET_VERSION, listError);
    candidates.push({
      id: profile.id,
      label: profile.label,
      cli: profile.command,
      cliPath,
      confidence,
      installedVersion,
      targetVersion: PI_X_IDE_TARGET_VERSION,
      needsInstall: reason === "missing" || reason === "outdated" || reason === "unknown",
      reason,
      listError,
    });
  }

  return candidates;
}

export function selectAutoInstallCandidate(
  candidates: IdeInstallCandidate[],
  env: NodeJS.ProcessEnv = process.env,
): IdeInstallCandidate | undefined {
  const configuredEnv = resolvePiConfigEnv(env);
  const currentIde = inferCurrentIdeFromEnv(configuredEnv);
  const highConfidence = candidates.filter(
    (candidate) =>
      candidate.confidence === "current-terminal" &&
      candidate.reason !== "unknown" &&
      (!currentIde || candidate.id === currentIde),
  );
  return highConfidence.length === 1 ? highConfidence[0] : undefined;
}

export async function installIdeExtension(
  candidate: IdeInstallCandidate,
  runtime: PiIdeRuntime,
  options: InstallIdeExtensionOptions = {},
): Promise<IdeInstallResult> {
  if (!candidate.needsInstall) {
    return { candidate, skipped: true, success: true, stdout: "", stderr: "" };
  }

  const installKey = candidate.id;
  if (runtime.installingIdeIds.has(installKey)) {
    return {
      candidate,
      skipped: true,
      success: false,
      stdout: "",
      stderr: "",
      error: `${candidate.label} extension install is already in progress.`,
    };
  }

  runtime.installingIdeIds.add(installKey);
  try {
    const { stdout, stderr } = await runCli(candidate.cliPath, buildInstallArgs(), options.timeoutMs ?? 60_000);
    return { candidate, skipped: false, success: true, stdout, stderr };
  } catch (error) {
    return {
      candidate,
      skipped: false,
      success: false,
      stdout: getExecOutput(error, "stdout"),
      stderr: getExecOutput(error, "stderr"),
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    runtime.installingIdeIds.delete(installKey);
  }
}

function resolveInstallReason(
  installedVersion: string | undefined,
  targetVersion: string,
  listError: string | undefined,
): IdeInstallReason {
  if (listError) return "unknown";
  if (!installedVersion) return "missing";
  const comparison = compareExtensionVersions(installedVersion, targetVersion);
  if (comparison === "older") return "outdated";
  if (comparison === "equal" || comparison === "newer") return "current";
  return "unknown";
}

function parseStableVersion(version: string): [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:$|[-+])/.exec(version.trim());
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function parsePathExt(env: NodeJS.ProcessEnv): string[] {
  const pathExt = env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD";
  const values = pathExt
    .split(";")
    .map((extension) => extension.trim())
    .filter(Boolean);
  // On Windows, skip extensionless search to avoid matching
  // non-executable shell scripts (e.g., VS Code ships both
  // `code` (sh) and `code.cmd` — only `.cmd` is executable).
  if (process.platform !== "win32") {
    return values.length > 0 ? ["", ...values] : [""];
  }
  return values;
}

function withExtension(command: string, extension: string): string {
  if (!extension) return command;
  return command.toLowerCase().endsWith(extension.toLowerCase()) ? command : `${command}${extension}`;
}

function isCmdOrBatFile(cliPath: string): boolean {
  const lowerPath = cliPath.toLowerCase();
  return lowerPath.endsWith(".cmd") || lowerPath.endsWith(".bat");
}

function resolveCmdExe(): string {
  return process.env.ComSpec ?? "cmd.exe";
}

function getExecOutput(error: unknown, key: "stdout" | "stderr"): string {
  if (typeof error !== "object" || error === null || !(key in error)) return "";
  const value = (error as Record<typeof key, unknown>)[key];
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  if (value === undefined || value === null) return "";
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return value.toString();
  return "";
}
