// ABOUTME: Resolves and reads/writes pi-x-ide config under global and project scopes.
// ABOUTME: Merges env overlays and top-level options like status_display and fixPrompt.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import {
  DEFAULT_STATUS_DISPLAY,
  isConfigEnvValue,
  STATUS_DISPLAY_VALUES,
  type StatusDisplay,
} from "./config-options.js";

export const EXT_CONFIG_NAME = "pi-x-ide";
export const CONFIG_DIR_NAME = ".pi";
export const PI_CONFIG_FILE = "config.json";
export const STATUS_DISPLAY_CONFIG_KEY = "status_display";
export const AUTO_INSTALL_ENV_KEY = "PI_X_IDE_AUTO_INSTALL";

export type ConfigScope = "global" | "project";

export interface StatusDisplayResolution {
  value: StatusDisplay;
  scope: ConfigScope | "default";
  path?: string;
}

export interface AutoInstallResolution {
  value: boolean;
  scope: ConfigScope | "default";
  path?: string;
}

/** Snapshot of settings editable via `/ide settings`. */
export interface IdeConfigSettings {
  display: StatusDisplay;
  autoInstall: boolean;
}

export interface IdeConfigSettingsResolution {
  settings: IdeConfigSettings;
  display: StatusDisplayResolution;
  autoInstall: AutoInstallResolution;
}

const processEnvOverlays = new WeakSet<NodeJS.ProcessEnv>();
const AUTO_INSTALL_DISABLED_VALUES = new Set(["0", "false", "off"]);

export function resolvePiConfigPath(home: string = homedir()): string {
  return resolvePiGlobalConfigPath(home);
}

export function resolvePiGlobalConfigPath(home: string = homedir()): string {
  return resolve(home, CONFIG_DIR_NAME, EXT_CONFIG_NAME, PI_CONFIG_FILE);
}

export function resolvePiProjectConfigPath(projectDir: string): string {
  return resolve(projectDir, CONFIG_DIR_NAME, EXT_CONFIG_NAME, PI_CONFIG_FILE);
}

export function readPiConfigFile(configPath: string): Record<string, unknown> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf8")) as unknown;
  } catch {
    return undefined;
  }
  return isRecord(parsed) ? parsed : undefined;
}

export function writePiConfigFile(partial: Record<string, unknown>, configPath: string): void {
  const existing = readPiConfigFile(configPath) ?? {};
  const merged: Record<string, unknown> = { ...existing, ...partial };
  // Deep-merge env so partial env keys do not wipe unrelated variables.
  if (isRecord(existing.env) || isRecord(partial.env)) {
    merged.env = {
      ...(isRecord(existing.env) ? existing.env : {}),
      ...(isRecord(partial.env) ? partial.env : {}),
    };
  }
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
}

export function readPiConfigEnv(configPath: string = resolvePiConfigPath()): NodeJS.ProcessEnv {
  const parsed = readPiConfigFile(configPath);
  if (!parsed || !isRecord(parsed.env)) return {};

  return Object.fromEntries(
    Object.entries(parsed.env)
      .filter((entry): entry is [string, string | number | boolean] => {
        const [key, value] = entry;
        return key.length > 0 && isConfigEnvValue(value);
      })
      .map(([key, value]) => [key, String(value)]),
  );
}

export function resolvePiConfigEnv(
  env: NodeJS.ProcessEnv = process.env,
  options: { configPath?: string; projectDir?: string; home?: string } = {},
): NodeJS.ProcessEnv {
  // Custom env objects without an explicit config source are left untouched.
  if (env !== process.env && !options.configPath && options.projectDir === undefined) {
    return env;
  }

  const configEnv: NodeJS.ProcessEnv = options.configPath
    ? readPiConfigEnv(options.configPath)
    : {
        ...readPiConfigEnv(resolvePiGlobalConfigPath(options.home)),
        ...(options.projectDir ? readPiConfigEnv(resolvePiProjectConfigPath(options.projectDir)) : {}),
      };

  if (Object.keys(configEnv).length === 0) return env;

  const merged = { ...configEnv, ...env };
  if (env === process.env) processEnvOverlays.add(merged);
  return merged;
}

export function isProcessEnvOrPiConfigOverlay(env: NodeJS.ProcessEnv): boolean {
  return env === process.env || processEnvOverlays.has(env);
}

export function readPiConfigFixPrompt(configPath: string = resolvePiConfigPath()): string | undefined {
  const parsed = readPiConfigFile(configPath);
  if (!parsed) return undefined;
  return typeof parsed.fixPrompt === "string" ? parsed.fixPrompt : undefined;
}

/**
 * Read status_display.
 * - string path: read only that file (tests / explicit path)
 * - options: project config overrides global; missing values fall back to default
 */
export function readPiConfigStatusDisplay(
  configPathOrOptions: string | { projectDir?: string; home?: string } = {},
): StatusDisplay {
  return resolvePiConfigStatusDisplay(configPathOrOptions).value;
}

export function resolvePiConfigStatusDisplay(
  configPathOrOptions: string | { projectDir?: string; home?: string } = {},
): StatusDisplayResolution {
  if (typeof configPathOrOptions === "string") {
    const value = readStatusDisplayFromFile(configPathOrOptions);
    return value === undefined
      ? { value: DEFAULT_STATUS_DISPLAY, scope: "default" }
      : { value, scope: "global", path: configPathOrOptions };
  }

  const projectDir = configPathOrOptions.projectDir;
  if (projectDir) {
    const projectPath = resolvePiProjectConfigPath(projectDir);
    const projectValue = readStatusDisplayFromFile(projectPath);
    if (projectValue !== undefined) {
      return { value: projectValue, scope: "project", path: projectPath };
    }
  }

  const globalPath = resolvePiGlobalConfigPath(configPathOrOptions.home);
  const globalValue = readStatusDisplayFromFile(globalPath);
  if (globalValue !== undefined) {
    return { value: globalValue, scope: "global", path: globalPath };
  }

  return { value: DEFAULT_STATUS_DISPLAY, scope: "default" };
}

export function resolvePiConfigAutoInstall(
  configPathOrOptions: string | { projectDir?: string; home?: string } = {},
): AutoInstallResolution {
  if (typeof configPathOrOptions === "string") {
    const raw = readEnvValueFromFile(configPathOrOptions, AUTO_INSTALL_ENV_KEY);
    return raw === undefined
      ? { value: true, scope: "default" }
      : { value: parseAutoInstallValue(raw), scope: "global", path: configPathOrOptions };
  }

  const projectDir = configPathOrOptions.projectDir;
  if (projectDir) {
    const projectPath = resolvePiProjectConfigPath(projectDir);
    const projectRaw = readEnvValueFromFile(projectPath, AUTO_INSTALL_ENV_KEY);
    if (projectRaw !== undefined) {
      return { value: parseAutoInstallValue(projectRaw), scope: "project", path: projectPath };
    }
  }

  const globalPath = resolvePiGlobalConfigPath(configPathOrOptions.home);
  const globalRaw = readEnvValueFromFile(globalPath, AUTO_INSTALL_ENV_KEY);
  if (globalRaw !== undefined) {
    return { value: parseAutoInstallValue(globalRaw), scope: "global", path: globalPath };
  }

  return { value: true, scope: "default" };
}

export function resolveIdeConfigSettings(
  options: { projectDir?: string; home?: string } = {},
): IdeConfigSettingsResolution {
  const display = resolvePiConfigStatusDisplay(options);
  const autoInstall = resolvePiConfigAutoInstall(options);
  return {
    settings: {
      display: display.value,
      autoInstall: autoInstall.value,
    },
    display,
    autoInstall,
  };
}

export function writePiConfigStatusDisplay(
  value: StatusDisplay,
  options: { scope: ConfigScope; projectDir?: string; home?: string },
): { path: string; scope: ConfigScope } {
  return writePiConfigSettings({ display: value }, options);
}

/** Write one or more `/ide settings` values to global or project config. */
export function writePiConfigSettings(
  settings: Partial<IdeConfigSettings>,
  options: { scope: ConfigScope; projectDir?: string; home?: string },
): { path: string; scope: ConfigScope } {
  const path =
    options.scope === "project"
      ? resolvePiProjectConfigPath(requireProjectDir(options.projectDir))
      : resolvePiGlobalConfigPath(options.home);

  const partial: Record<string, unknown> = {};
  if (settings.display !== undefined) {
    partial[STATUS_DISPLAY_CONFIG_KEY] = settings.display;
  }
  if (settings.autoInstall !== undefined) {
    partial.env = {
      [AUTO_INSTALL_ENV_KEY]: settings.autoInstall ? "true" : "false",
    };
  }

  writePiConfigFile(partial, path);
  return { path, scope: options.scope };
}

export function parseAutoInstallValue(value: string): boolean {
  return !AUTO_INSTALL_DISABLED_VALUES.has(value.trim().toLowerCase());
}

function requireProjectDir(projectDir: string | undefined): string {
  if (!projectDir) {
    throw new Error("projectDir is required when saving project config");
  }
  return projectDir;
}

function readStatusDisplayFromFile(configPath: string): StatusDisplay | undefined {
  const parsed = readPiConfigFile(configPath);
  if (!parsed || typeof parsed[STATUS_DISPLAY_CONFIG_KEY] !== "string") return undefined;
  const value = parsed[STATUS_DISPLAY_CONFIG_KEY];
  return isStatusDisplay(value) ? value : undefined;
}

function readEnvValueFromFile(configPath: string, key: string): string | undefined {
  const env = readPiConfigEnv(configPath);
  return env[key];
}

function isStatusDisplay(value: string): value is StatusDisplay {
  return (STATUS_DISPLAY_VALUES as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
