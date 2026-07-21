// ABOUTME: Interactive TUI settings dialog for pi-x-ide configuration.
// ABOUTME: Multi-row SettingsList with Space cycling; Ctrl+S/P save global/project config.
import type { ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent" with {
  "resolution-mode": "import",
};
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import {
  Container,
  Key,
  matchesKey,
  SettingsList,
  Text,
  type SettingItem,
  type SettingsListTheme,
} from "@earendil-works/pi-tui";
import {
  resolveIdeConfigSettings,
  writePiConfigSettings,
  type ConfigScope,
  type IdeConfigSettings,
} from "../shared/config.js";
import {
  DEFAULT_STATUS_DISPLAY,
  STATUS_DISPLAY_VALUES,
  type StatusDisplay,
} from "../shared/config-options.js";
import { logExtensionError } from "../shared/errors.js";
import type { PiIdeRuntime } from "./state.js";
import { updateIdeUi } from "./ui.js";

const DISPLAY_SETTING_ID = "display";
const AUTO_INSTALL_SETTING_ID = "autoInstall";
const BOOLEAN_SETTING_VALUES = ["true", "false"] as const;

type ConfigDialogResult =
  | { action: "save"; settings: IdeConfigSettings; scope: ConfigScope }
  | { action: "cancel" };

/** @deprecated Prefer showIdeSettings. */
export async function showStatusDisplayConfig(
  runtime: PiIdeRuntime,
  ctx: ExtensionCommandContext,
  options: { home?: string } = {},
): Promise<void> {
  return showIdeSettings(runtime, ctx, options);
}

/** @deprecated Prefer showIdeSettings. */
export async function showIdeConfig(
  runtime: PiIdeRuntime,
  ctx: ExtensionCommandContext,
  options: { home?: string } = {},
): Promise<void> {
  return showIdeSettings(runtime, ctx, options);
}

export async function showIdeSettings(
  runtime: PiIdeRuntime,
  ctx: ExtensionCommandContext,
  options: { home?: string } = {},
): Promise<void> {
  const resolved = resolveIdeConfigSettings({ projectDir: ctx.cwd, home: options.home });
  const result = await ctx.ui.custom<ConfigDialogResult>((tui, theme, _keybindings, done) => {
    const draft: IdeConfigSettings = {
      display: resolved.settings.display ?? DEFAULT_STATUS_DISPLAY,
      autoInstall: resolved.settings.autoInstall,
    };

    const items: SettingItem[] = [
      {
        id: DISPLAY_SETTING_ID,
        label: "Display",
        description: "IDE status placement: widget (above editor) or statusline (footer)",
        currentValue: draft.display,
        values: [...STATUS_DISPLAY_VALUES],
      },
      {
        id: AUTO_INSTALL_SETTING_ID,
        label: "AutoInstall",
        description: "Auto-install VS Code-family extension on Pi startup (PI_X_IDE_AUTO_INSTALL)",
        currentValue: draft.autoInstall ? "true" : "false",
        values: [...BOOLEAN_SETTING_VALUES],
      },
    ];

    const settingsList = new SettingsList(
      items,
      Math.min(items.length + 2, 10),
      createSettingsListTheme(theme),
      (id, newValue) => {
        if (id === DISPLAY_SETTING_ID && isStatusDisplayValue(newValue)) {
          draft.display = newValue;
          return;
        }
        if (id === AUTO_INSTALL_SETTING_ID && isBooleanSettingValue(newValue)) {
          draft.autoInstall = newValue === "true";
        }
      },
      () => done({ action: "cancel" }),
      { enableSearch: false },
    );

    const title = theme.fg("accent", theme.bold("Settings:"));
    const help = theme.fg(
      "dim",
      "↑↓ navigate · space cycle · ctrl+s save global · ctrl+p save project · esc cancel",
    );

    const container = new Container();
    container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
    container.addChild(new Text(title, 1, 0));
    container.addChild(settingsList);
    container.addChild(new Text(help, 1, 0));
    container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));

    const saveCurrent = (scope: ConfigScope): void => {
      done({
        action: "save",
        settings: { display: draft.display, autoInstall: draft.autoInstall },
        scope,
      });
    };

    return {
      render: (width) => container.render(width),
      invalidate: () => container.invalidate(),
      handleInput: (data) => {
        if (matchesKey(data, Key.ctrl("s"))) {
          saveCurrent("global");
          return;
        }
        if (matchesKey(data, Key.ctrl("p"))) {
          saveCurrent("project");
          return;
        }
        settingsList.handleInput(data);
        tui.requestRender();
      },
    };
  });

  if (!result || result.action === "cancel") return;

  try {
    const saved = writePiConfigSettings(result.settings, {
      scope: result.scope,
      projectDir: ctx.cwd,
      home: options.home,
    });
    updateIdeUi(runtime, ctx, result.settings.display);
    ctx.ui.notify(
      [
        `Saved to ${saved.scope}: ${saved.path}`,
        `Display=${result.settings.display}`,
        `AutoInstall=${result.settings.autoInstall}`,
      ].join("\n"),
      "info",
    );
  } catch (error) {
    logExtensionError("save ide settings", error);
    ctx.ui.notify(
      `Failed to save settings: ${error instanceof Error ? error.message : String(error)}`,
      "error",
    );
  }
}

function isStatusDisplayValue(value: string): value is StatusDisplay {
  return (STATUS_DISPLAY_VALUES as readonly string[]).includes(value);
}

function isBooleanSettingValue(value: string): value is (typeof BOOLEAN_SETTING_VALUES)[number] {
  return (BOOLEAN_SETTING_VALUES as readonly string[]).includes(value);
}

function createSettingsListTheme(theme: Theme): SettingsListTheme {
  return {
    label: (text, selected) => (selected ? theme.fg("accent", text) : text),
    value: (text, selected) => (selected ? theme.fg("accent", text) : theme.fg("muted", text)),
    description: (text) => theme.fg("dim", text),
    cursor: theme.fg("accent", "→ "),
    hint: (text) => theme.fg("dim", text),
  };
}
