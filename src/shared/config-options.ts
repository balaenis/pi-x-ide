export type ConfigEnvValueType = "string" | "number" | "boolean";

export interface ConfigEnvOption {
  readonly type: readonly ConfigEnvValueType[];
  readonly description: string;
  readonly default?: string;
}

export interface ConfigEnvPatternOption extends ConfigEnvOption {
  readonly pattern: string;
}

export const CONFIG_ENV_VALUE_TYPES = ["string", "number", "boolean"] as const satisfies readonly ConfigEnvValueType[];

export function isConfigEnvValue(value: unknown): value is string | number | boolean {
  return CONFIG_ENV_VALUE_TYPES.some((type) => typeof value === type);
}

export const CONFIG_ENV_OPTIONS = {
  PI_X_IDE_AUTO_INSTALL: {
    type: ["string", "number", "boolean"],
    default: "enabled",
    description: "Controls VS Code-family extension auto-install. Values 0, false, and off disable it.",
  },
  PI_X_IDE_ATTACH_SHORTCUT: {
    type: ["string"],
    default: "ctrl+alt+k",
    description: "Pi TUI shortcut for attaching the latest IDE selection. Set to off, none, false, or 0 to disable.",
  },
  PI_X_IDE_ZED_DB: {
    type: ["string"],
    description: "Override path to Zed's SQLite database.",
  },
  PI_X_IDE_ZED_POLL_INTERVAL_MS: {
    type: ["string", "number"],
    description: "Polling interval in milliseconds when checking Zed's SQLite database for selection changes.",
    default: "1000",
  },
} as const satisfies Record<string, ConfigEnvOption>;

export const CONFIG_ENV_PATTERN_OPTIONS = [] as const satisfies readonly ConfigEnvPatternOption[];

export type ConfigEnvOptionName = keyof typeof CONFIG_ENV_OPTIONS;
