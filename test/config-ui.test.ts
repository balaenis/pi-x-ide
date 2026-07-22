// ABOUTME: Covers /ide settings multi-setting dialog save paths and cancel.
// ABOUTME: Mocks ctx.ui.custom to exercise global and project save handlers.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DynamicBorder, showIdeSettings } from "../src/pi/config-ui.js";
import { createRuntime } from "../src/pi/state.js";
import {
  AUTO_INSTALL_ENV_KEY,
  CONFIG_DIR_NAME,
  EXT_CONFIG_NAME,
  readPiConfigStatusDisplay,
  resolvePiGlobalConfigPath,
  resolvePiProjectConfigPath,
  type IdeConfigSettings,
} from "../src/shared/config.js";

type DialogResult = { action: "save"; settings: IdeConfigSettings; scope: "global" | "project" } | { action: "cancel" };

interface CapturedInput {
  handleInput?: (data: string) => void;
}

const CTRL_S_INPUT = String.fromCharCode(19);

async function withTempHomeAndProject(
  run: (paths: { home: string; projectDir: string }) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "pi-x-ide-config-ui-"));
  const home = join(root, "home");
  const projectDir = join(root, "project");
  try {
    await run({ home, projectDir });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function createCtx(
  projectDir: string,
  resultOrCapture: DialogResult | ((capture: CapturedInput) => DialogResult | Promise<DialogResult>),
  notifications: string[] = [],
) {
  return {
    cwd: projectDir,
    hasUI: true,
    ui: {
      custom: async (factory: (...args: unknown[]) => { handleInput?: (data: string) => void }) => {
        const capture: CapturedInput = {};
        const component = factory(
          { requestRender: () => undefined },
          {
            fg: (_color: string, text: string) => text,
            bold: (text: string) => text,
          },
          {},
          () => undefined,
        );
        capture.handleInput = component.handleInput;
        if (typeof resultOrCapture === "function") return resultOrCapture(capture);
        return resultOrCapture;
      },
      notify: (message: string) => {
        notifications.push(message);
      },
      setWidget: () => {},
      setStatus: () => {},
    },
  };
}

void test("showIdeSettings saves Display and AutoInstall to global config", async () => {
  await withTempHomeAndProject(async ({ home, projectDir }) => {
    const runtime = createRuntime();
    runtime.cwd = projectDir;
    const notifications: string[] = [];
    const ctx = createCtx(
      projectDir,
      {
        action: "save",
        settings: { display: "statusline", autoInstall: false },
        scope: "global",
      },
      notifications,
    );

    await showIdeSettings(runtime, ctx as never, { home });

    const globalPath = resolvePiGlobalConfigPath(home);
    const raw = JSON.parse(await readFile(globalPath, "utf8")) as {
      status_display?: string;
      env?: Record<string, string>;
    };
    assert.equal(readPiConfigStatusDisplay(globalPath), "statusline");
    assert.equal(raw.env?.[AUTO_INSTALL_ENV_KEY], "false");
    assert.match(notifications[0] ?? "", /Saved to global/);
    assert.match(notifications[0] ?? "", /Display=statusline/);
    assert.match(notifications[0] ?? "", /AutoInstall=false/);
  });
});

void test("showIdeSettings saves Display and AutoInstall to project config", async () => {
  await withTempHomeAndProject(async ({ home, projectDir }) => {
    const runtime = createRuntime();
    runtime.cwd = projectDir;
    const notifications: string[] = [];
    const ctx = createCtx(
      projectDir,
      {
        action: "save",
        settings: { display: "widget", autoInstall: true },
        scope: "project",
      },
      notifications,
    );

    await showIdeSettings(runtime, ctx as never, { home });

    const projectPath = resolvePiProjectConfigPath(projectDir);
    const raw = JSON.parse(await readFile(projectPath, "utf8")) as {
      status_display?: string;
      env?: Record<string, string>;
    };
    assert.equal(raw.status_display, "widget");
    assert.equal(raw.env?.[AUTO_INSTALL_ENV_KEY], "true");
    assert.match(notifications[0] ?? "", /Saved to project/);
  });
});

void test("showIdeSettings cancel leaves config untouched", async () => {
  await withTempHomeAndProject(async ({ home, projectDir }) => {
    const runtime = createRuntime();
    const notifications: string[] = [];
    const ctx = createCtx(projectDir, { action: "cancel" }, notifications);

    await showIdeSettings(runtime, ctx as never, { home });

    assert.equal(notifications.length, 0);
    await assert.rejects(() => readFile(resolvePiGlobalConfigPath(home), "utf8"));
    await assert.rejects(() => readFile(join(projectDir, CONFIG_DIR_NAME, EXT_CONFIG_NAME, "config.json"), "utf8"));
  });
});

void test("showIdeSettings honors the host keybinding manager in the bundled SettingsList", async () => {
  await withTempHomeAndProject(async ({ home, projectDir }) => {
    const runtime = createRuntime();
    let dialogResult: DialogResult | undefined;
    const hostKeybindings = {
      matches: (data: string, keybinding: string) => data === "j" && keybinding === "tui.select.down",
    };
    const ctx = {
      cwd: projectDir,
      hasUI: true,
      ui: {
        custom: (
          factory: (
            tui: { requestRender: () => void },
            theme: { fg: (_color: string, text: string) => string; bold: (text: string) => string },
            keybindings: typeof hostKeybindings,
            done: (result: DialogResult) => void,
          ) => { handleInput?: (data: string) => void },
        ) => {
          const component = factory(
            { requestRender: () => undefined },
            {
              fg: (_color: string, text: string) => text,
              bold: (text: string) => text,
            },
            hostKeybindings,
            (result) => {
              dialogResult = result;
            },
          );
          component.handleInput?.("j");
          component.handleInput?.(" ");
          component.handleInput?.(CTRL_S_INPUT);
          return Promise.resolve(dialogResult);
        },
        notify: () => {},
        setWidget: () => {},
        setStatus: () => {},
      },
    };

    await showIdeSettings(runtime, ctx as never, { home });

    const raw = JSON.parse(await readFile(resolvePiGlobalConfigPath(home), "utf8")) as {
      env?: Record<string, string>;
    };
    assert.equal(raw.env?.[AUTO_INSTALL_ENV_KEY], "false");
  });
});

void test("local DynamicBorder renders a full-width accent line and invalidates safely", () => {
  const painted: string[] = [];
  const border = new DynamicBorder((text) => {
    painted.push(text);
    return `ACCENT(${text})`;
  });

  const narrow = border.render(3);
  assert.deepEqual(narrow, ["ACCENT(───)"]);
  assert.equal(painted[0], "───");

  const wide = border.render(10);
  assert.deepEqual(wide, ["ACCENT(──────────)"]);

  assert.deepEqual(border.render(0), ["ACCENT()"]);

  assert.doesNotThrow(() => border.invalidate());
});

void test("showIdeSettings dialog includes top and bottom dynamic borders", async () => {
  await withTempHomeAndProject(async ({ home, projectDir }) => {
    const runtime = createRuntime();
    let rendered: string[] | undefined;

    const ctx = {
      cwd: projectDir,
      hasUI: true,
      ui: {
        custom: (factory: (...args: unknown[]) => { render: (width: number) => string[] }) => {
          const component = factory(
            { requestRender: () => undefined },
            {
              fg: (_color: string, text: string) => text,
              bold: (text: string) => text,
            },
            {},
            () => undefined,
          );
          rendered = component.render(20);
          return Promise.resolve({ action: "cancel" as const });
        },
        notify: () => {},
        setWidget: () => {},
        setStatus: () => {},
      },
    };

    await showIdeSettings(runtime, ctx as never, { home });

    assert.ok(rendered && rendered.length >= 2, "expected dialog render output");
    const lines = rendered ?? [];
    const borderLines = lines.filter((line) => line.includes("─".repeat(20)) || /^─{20}$/.test(line.trim()));
    // Top and bottom borders should both span the full width.
    assert.ok(borderLines.length >= 2, `expected >=2 border lines, got: ${JSON.stringify(rendered)}`);
  });
});
