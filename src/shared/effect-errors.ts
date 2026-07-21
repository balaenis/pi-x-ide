// ABOUTME: Defines Effect tagged domain errors for pi-x-ide shared and Pi-side workflows.
// ABOUTME: Keeps failure types structured without changing on-wire protocol payloads.
import * as Data from "effect/Data";

function describeUnknown(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

export class LockFileParseError extends Data.TaggedError("LockFileParseError")<{
  readonly path?: string;
  readonly reason: string;
}> {
  override get message(): string {
    return this.path
      ? `LockFileParseError: ${this.reason} (${this.path})`
      : `LockFileParseError: ${this.reason}`;
  }
}

export class LockDirReadError extends Data.TaggedError("LockDirReadError")<{
  readonly path: string;
  readonly cause: unknown;
}> {
  override get message(): string {
    return `LockDirReadError: failed to read ${this.path}: ${describeUnknown(this.cause)}`;
  }
}

export class IdeConnectTimeoutError extends Data.TaggedError("IdeConnectTimeoutError")<{
  readonly name: string;
  readonly host: string;
  readonly port: number;
}> {
  override get message(): string {
    return `IdeConnectTimeoutError: ${this.name} at ${this.host}:${this.port}`;
  }
}

export class IdeConnectError extends Data.TaggedError("IdeConnectError")<{
  readonly host: string;
  readonly port: number;
  readonly cause: unknown;
}> {
  override get message(): string {
    return `IdeConnectError: ${this.host}:${this.port}: ${describeUnknown(this.cause)}`;
  }
}

export class ConfigParseError extends Data.TaggedError("ConfigParseError")<{
  readonly path: string;
  readonly reason: string;
}> {
  override get message(): string {
    return `ConfigParseError: ${this.reason} (${this.path})`;
  }
}

export class InstallCommandError extends Data.TaggedError("InstallCommandError")<{
  readonly cli: string;
  readonly code?: number | null;
  readonly stderr: string;
  readonly stdout?: string;
}> {
  override get message(): string {
    const exitPart = this.code === undefined ? "" : ` exited ${String(this.code)}`;
    const detail = this.stderr.trim() || this.stdout?.trim() || "command failed";
    return `InstallCommandError: ${this.cli}${exitPart}: ${detail}`;
  }
}
