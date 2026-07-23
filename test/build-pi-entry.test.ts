// ABOUTME: Exercises Pi entry metafile topology guards with direct and transitive dependencies.
// ABOUTME: Ensures heavy static inputs and host runtime edges fail while lazy heavy chunks remain valid.
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const BUILD_SCRIPT = join(TEST_DIR, "../../scripts/build-pi-entry.mjs");
const ENTRY_OUTPUT = "dist/src/pi/index.js";
const ENTRY_INPUT = "src/pi/index.ts";

interface BuildScriptModule {
  validateMetafile: (metafile: unknown) => void;
}

async function loadBuildScript(): Promise<BuildScriptModule> {
  const loaded = (await import(pathToFileURL(BUILD_SCRIPT).href)) as Partial<BuildScriptModule>;
  assert.equal(typeof loaded.validateMetafile, "function");
  return loaded as BuildScriptModule;
}

function createEntryOutput(imports: Array<Record<string, unknown>> = [], inputs: Record<string, unknown> = {}) {
  return {
    entryPoint: ENTRY_INPUT,
    imports,
    inputs: { [ENTRY_INPUT]: { bytesInOutput: 1 }, ...inputs },
  };
}

void test("metafile guard rejects heavy inputs bundled directly into the entry", async () => {
  const { validateMetafile } = await loadBuildScript();
  const metafile = {
    inputs: {},
    outputs: {
      [ENTRY_OUTPUT]: createEntryOutput([], {
        "node_modules/effect/dist/esm/Effect.js": { bytesInOutput: 1 },
      }),
    },
  };

  assert.throws(() => validateMetafile(metafile), /static entry graph contains heavy inputs/);
});

void test("metafile guard rejects heavy inputs through transitive static chunks", async () => {
  const { validateMetafile } = await loadBuildScript();
  const metafile = {
    inputs: {},
    outputs: {
      [ENTRY_OUTPUT]: createEntryOutput([{ path: "./chunks/shell.js", kind: "import-statement" }]),
      "dist/src/pi/chunks/shell.js": {
        imports: [{ path: "./heavy.js", kind: "import-statement" }],
        inputs: { "src/pi/shell.ts": { bytesInOutput: 1 } },
      },
      "dist/src/pi/chunks/heavy.js": {
        imports: [],
        inputs: { "node_modules/ws/index.js": { bytesInOutput: 1 } },
      },
    },
  };

  assert.throws(() => validateMetafile(metafile), /node_modules\/ws\//);
});

void test("metafile guard allows heavy inputs behind a dynamic import", async () => {
  const { validateMetafile } = await loadBuildScript();
  const metafile = {
    inputs: {},
    outputs: {
      [ENTRY_OUTPUT]: createEntryOutput([{ path: "./chunks/runtime.js", kind: "dynamic-import" }]),
      "dist/src/pi/chunks/runtime.js": {
        imports: [],
        inputs: { "node_modules/effect/dist/esm/Effect.js": { bytesInOutput: 1 } },
      },
    },
  };

  assert.doesNotThrow(() => validateMetafile(metafile));
});

void test("metafile guard rejects host package runtime edges in any output", async () => {
  const { validateMetafile } = await loadBuildScript();
  const metafile = {
    inputs: {},
    outputs: {
      [ENTRY_OUTPUT]: createEntryOutput([{ path: "./chunks/config-ui.js", kind: "dynamic-import" }]),
      "dist/src/pi/chunks/config-ui.js": {
        imports: [{ path: "@earendil-works/pi-tui", kind: "import-statement", external: true }],
        inputs: { "src/pi/config-ui.ts": { bytesInOutput: 1 } },
      },
    },
  };

  assert.throws(() => validateMetafile(metafile), /host-package runtime external edge/);
});
