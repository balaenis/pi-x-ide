import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

export const PI_CONFIG_FILE = "config.json";

const processEnvOverlays = new WeakSet<NodeJS.ProcessEnv>();

export function resolvePiConfigPath(home: string = homedir()): string {
  return resolve(home, ".pi", PI_CONFIG_FILE);
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
        return key.length > 0 && (typeof value === "string" || typeof value === "number" || typeof value === "boolean");
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
