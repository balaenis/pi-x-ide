import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import {
  DEFAULT_STATUS_DISPLAY,
  isConfigEnvValue,
  STATUS_DISPLAY_VALUES,
  type StatusDisplay,
} from "./config-options.js";

export const EXT_CONFIG_NAME = "pi-x-ide";
export const CONFIG_DIR_NAME = ".pi";
export const PI_CONFIG_FILE = "config.json";

const processEnvOverlays = new WeakSet<NodeJS.ProcessEnv>();

export function resolvePiConfigPath(home: string = homedir()): string {
  return resolve(home, CONFIG_DIR_NAME, EXT_CONFIG_NAME, PI_CONFIG_FILE);
}

export function readPiConfigEnv(configPath: string = resolvePiConfigPath()): NodeJS.ProcessEnv {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf8")) as unknown;
  } catch {
    return {};
  }

  if (!isRecord(parsed) || !isRecord(parsed.env)) return {};

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
  options: { configPath?: string } = {},
): NodeJS.ProcessEnv {
  if (env !== process.env && !options.configPath) return env;

  const configEnv = readPiConfigEnv(options.configPath);
  if (Object.keys(configEnv).length === 0) return env;

  const merged = { ...configEnv, ...env };
  if (env === process.env) processEnvOverlays.add(merged);
  return merged;
}

export function isProcessEnvOrPiConfigOverlay(env: NodeJS.ProcessEnv): boolean {
  return env === process.env || processEnvOverlays.has(env);
}

export function readPiConfigFixPrompt(configPath: string = resolvePiConfigPath()): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf8")) as unknown;
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  return typeof parsed.fixPrompt === "string" ? parsed.fixPrompt : undefined;
}

export function readPiConfigStatusDisplay(configPath: string = resolvePiConfigPath()): StatusDisplay {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf8")) as unknown;
  } catch {
    return DEFAULT_STATUS_DISPLAY;
  }
  if (!isRecord(parsed) || typeof parsed.status_display !== "string") return DEFAULT_STATUS_DISPLAY;
  return isStatusDisplay(parsed.status_display) ? parsed.status_display : DEFAULT_STATUS_DISPLAY;
}

function isStatusDisplay(value: string): value is StatusDisplay {
  return (STATUS_DISPLAY_VALUES as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
