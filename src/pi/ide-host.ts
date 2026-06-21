// ABOUTME: Resolves the host Pi should use when connecting to IDE WebSocket lock files.
// ABOUTME: Handles config overrides and WSL-to-Windows gateway probing for native Windows IDEs.
import { execFile } from "node:child_process";
import { createConnection } from "node:net";
import { promisify } from "node:util";
import type { IdeLockFile } from "../shared/protocol";
import { resolvePiConfigEnv } from "../shared/config";
import { isWsl } from "../shared/platform";

export const PI_X_IDE_HOST_OVERRIDE_ENV = "PI_X_IDE_HOST_OVERRIDE";
export const IDE_HOST_TCP_PROBE_TIMEOUT_MS = 500;

const execFileAsync = promisify(execFile);

export interface ResolveIdeHostOptions {
  env?: NodeJS.ProcessEnv;
  runCommand?: (command: string, args: string[]) => Promise<{ stdout: string }>;
  tcpProbe?: (host: string, port: number, timeoutMs: number) => Promise<boolean>;
  timeoutMs?: number;
}

export async function resolveIdeHost(lock: IdeLockFile, options: ResolveIdeHostOptions = {}): Promise<string> {
  const env = resolvePiConfigEnv(options.env ?? process.env);
  const override = env[PI_X_IDE_HOST_OVERRIDE_ENV]?.trim();
  if (override) return override;

  if (lock.runningInWindows === true && isWsl(env)) {
    const gateway = await resolveWslDefaultGateway(options.runCommand ?? defaultRunCommand);
    if (gateway) {
      const reachable = await (options.tcpProbe ?? tcpReachable)(
        gateway,
        lock.port,
        options.timeoutMs ?? IDE_HOST_TCP_PROBE_TIMEOUT_MS,
      );
      if (reachable) return gateway;
    }
  }

  return lock.host || "127.0.0.1";
}

export async function resolveWslDefaultGateway(
  runCommand: (command: string, args: string[]) => Promise<{ stdout: string }> = defaultRunCommand,
): Promise<string | undefined> {
  try {
    const { stdout } = await runCommand("ip", ["route", "show"]);
    return parseDefaultGateway(stdout);
  } catch {
    return undefined;
  }
}

export function parseDefaultGateway(output: string): string | undefined {
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^default\s+via\s+(\d{1,3}(?:\.\d{1,3}){3})(?:\s|$)/);
    if (match) return match[1];
  }
  return undefined;
}

async function defaultRunCommand(command: string, args: string[]): Promise<{ stdout: string }> {
  const { stdout } = await execFileAsync(command, args, { encoding: "utf8" });
  return { stdout };
}

export function tcpReachable(host: string, port: number, timeoutMs = IDE_HOST_TCP_PROBE_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    let settled = false;
    const finish = (reachable: boolean) => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}
