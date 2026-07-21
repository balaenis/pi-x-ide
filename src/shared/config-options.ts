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
    description: "Controls VS Code extension auto-install. Values 0, false, and off disable it.",
  },
  PI_X_IDE_ATTACH_SHORTCUT: {
    type: ["string"],
    default: "ctrl+alt+k",
    description: "Pi TUI shortcut for attaching the latest IDE selection. Set to off, none, false, or 0 to disable.",
  },
  PI_X_IDE_HOST_OVERRIDE: {
    type: ["string"],
    description:
      "Override the host Pi uses to connect to IDE WebSocket lock files. Useful for WSL2 or custom networking.",
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

export interface ConfigOption {
  readonly type: readonly ConfigEnvValueType[];
  readonly description: string;
  readonly default?: string;
  readonly enum?: readonly string[];
}

export const STATUS_DISPLAY_VALUES = ["widget", "statusline"] as const;
export type StatusDisplay = (typeof STATUS_DISPLAY_VALUES)[number];
export const DEFAULT_STATUS_DISPLAY: StatusDisplay = "widget";

export const CONFIG_OPTIONS = {
  fixPrompt: {
    type: ["string"],
    default: "Analyze the errors and warnings at the following location, and try to fix them:\n{DIAGNOSTIC}",
    description:
      "Custom prompt prefix when requesting a fix for IDE diagnostics. Use {DIAGNOSTIC} as a placeholder for the diagnostic context. If the placeholder is omitted, the diagnostic context is appended after your prompt.",
  },
  status_display: {
    type: ["string"],
    default: DEFAULT_STATUS_DISPLAY,
    enum: STATUS_DISPLAY_VALUES,
    description:
      'Where to show IDE connection status. Use "widget" for the above-editor widget (default), or "statusline" for the default footer status line.',
  },
} as const satisfies Record<string, ConfigOption>;
