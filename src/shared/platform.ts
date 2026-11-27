// ABOUTME: Shared host-platform helpers for WSL detection and Windows/UNC path normalization.
// ABOUTME: Centralizes WSL-aware logic reused by Zed, discovery, connection, and formatting.
import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { isProcessEnvOrPiConfigOverlay, resolvePiConfigEnv } from "./config.js";
import type { EditorSelectionSnapshot } from "./protocol.js";

// Windows system profile directories that never host a real user lock directory.
const WINDOWS_SYSTEM_PROFILES = new Set(["public", "default", "default user", "all users"]);

// /proc/version is a kernel pseudo-file that cannot change while the process runs.
// Memoizing it keeps WSL detection off the filesystem on hot paths.
let procVersionIsWsl: boolean | undefined;

function procVersionIndicatesWsl(): boolean {
  if (procVersionIsWsl === undefined) {
    try {
      procVersionIsWsl = /microsoft|wsl/i.test(readFileSync("/proc/version", "utf8"));
    } catch {
      procVersionIsWsl = false;
    }
  }
  return procVersionIsWsl;
}

export function isWsl(env: NodeJS.ProcessEnv = process.env): boolean {
  const configuredEnv = resolvePiConfigEnv(env);
  if (configuredEnv.WSL_DISTRO_NAME || configuredEnv.WSL_INTEROP) return true;
  if (!isProcessEnvOrPiConfigOverlay(configuredEnv)) return false;
  return procVersionIndicatesWsl();
}

// Convert a Windows drive path or WSL UNC path to a Linux path visible from the
// current WSL distro. Non-WSL hosts and unrelated paths are returned unchanged.
//
// Handles both separator styles, because IDEs differ: VS Code reports Windows
// backslash paths, while IntelliJ's VirtualFile.getPath() is system-independent
// and reports WSL UNC paths with forward slashes (e.g. //wsl.localhost/<distro>/...).
export function normalizePathForHost(input: string, env: NodeJS.ProcessEnv = process.env): string {
  const configuredEnv = resolvePiConfigEnv(env);
  if (!input || !isWsl(configuredEnv)) return input;

  const driveMatch = input.match(/^([a-zA-Z]):[\\/](.*)$/);
  if (driveMatch) {
    const drive = driveMatch[1].toLowerCase();
    const rest = driveMatch[2].replaceAll("\\", "/");
    return `/mnt/${drive}/${rest}`;
  }

  // Accept \\wsl$\, \\wsl.localhost\, //wsl$/, and //wsl.localhost/ prefixes.
  const uncMatch = input.match(/^[\\/]{2}(?:wsl\$|wsl\.localhost)[\\/]([^\\/]+)[\\/](.*)$/i);
  if (uncMatch) {
    const distro = uncMatch[1];
    const rest = uncMatch[2].replaceAll("\\", "/");
    const currentDistro = configuredEnv.WSL_DISTRO_NAME;
    if (!currentDistro || distro.toLowerCase() === currentDistro.toLowerCase()) {
      return `/${rest}`;
    }
  }

  return input;
}

// List the user profile directory names under /mnt/c/Users, excluding Windows
// system profiles and dotfiles. Returns an empty list when not under WSL or the
// mount is unavailable. Async on purpose: this directory lives on drvfs, where a
// synchronous readdir would block the TUI event loop for the duration of the RPC.
export async function windowsUserProfileDirs(
  usersRoot = "/mnt/c/Users",
  env: NodeJS.ProcessEnv = process.env,
): Promise<string[]> {
  if (!isWsl(env)) return [];
  try {
    const entries = await readdir(usersRoot, { withFileTypes: true });
    return entries
      .filter(
        (entry) =>
          entry.isDirectory() && !entry.name.startsWith(".") && !WINDOWS_SYSTEM_PROFILES.has(entry.name.toLowerCase()),
      )
      .map((entry) => resolve(usersRoot, entry.name));
  } catch {
    return [];
  }
}

export function normalizeEditorSelectionSnapshotForHost<T extends EditorSelectionSnapshot>(
  snapshot: T,
  env: NodeJS.ProcessEnv = process.env,
): T {
  return {
    ...snapshot,
    filePath: normalizePathForHost(snapshot.filePath, env),
    workspaceFolder: snapshot.workspaceFolder ? normalizePathForHost(snapshot.workspaceFolder, env) : undefined,
  };
}
