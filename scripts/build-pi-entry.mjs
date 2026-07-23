// ABOUTME: Bundles the Pi extension entry with esbuild code-splitting for fast startup.
// ABOUTME: Bans Pi host-package runtime external edges so jiti aliases cannot be bypassed.
import * as esbuild from "esbuild";
import { access, mkdir, readdir, rm, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const ENTRY_POINT = join(REPO_ROOT, "src/pi/index.ts");
const OUT_DIR = join(REPO_ROOT, "dist/src/pi");
const ENTRY_OUT = join(OUT_DIR, "index.js");
const ENTRY_MAP_OUT = join(OUT_DIR, "index.js.map");
const CHUNKS_DIR = join(OUT_DIR, "chunks");

// Host packages that must never appear as runtime external edges in generated output.
// coding-agent stays in esbuild `external` for future safety checks (type-only imports
// erase); pi-tui is intentionally NOT external so the lazy config-ui chunk bundles it.
const PI_HOST_PACKAGES = ["@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"];
const PI_HOST_EXTERNAL_ALLOWLIST = ["@earendil-works/pi-coding-agent"];
const HEAVY_INPUT_MARKERS = [
  "node_modules/effect/",
  "node_modules/ws/",
  "node:sqlite",
  "node_modules/@earendil-works/pi-tui/",
];
const MAX_ENTRY_BYTES = 100 * 1024;
const MAX_TOTAL_PI_ENTRY_BYTES = 1.5 * 1024 * 1024;

async function main() {
  await cleanPreviousOutputs();
  await mkdir(OUT_DIR, { recursive: true });

  // CJS deps such as `ws` call require("events"). In ESM output esbuild's
  // __require shim only works when a CommonJS require exists in scope.
  const nodeCreateRequireBanner = [
    'import { createRequire as __piCreateRequire } from "node:module";',
    "const require = __piCreateRequire(import.meta.url);",
  ].join("");

  const result = await esbuild.build({
    absWorkingDir: REPO_ROOT,
    entryPoints: [ENTRY_POINT],
    bundle: true,
    splitting: true,
    format: "esm",
    platform: "node",
    target: "node26",
    outdir: OUT_DIR,
    entryNames: "index",
    chunkNames: "chunks/[name]-[hash]",
    external: [...PI_HOST_EXTERNAL_ALLOWLIST],
    banner: {
      js: nodeCreateRequireBanner,
    },
    minify: false,
    sourcemap: false,
    metafile: true,
    logLevel: "info",
  });

  validateMetafile(result.metafile);
  await validateOutputSizes();
  console.log("Pi entry bundle complete:", relative(REPO_ROOT, ENTRY_OUT));
}

async function cleanPreviousOutputs() {
  await rm(ENTRY_OUT, { force: true });
  await rm(ENTRY_MAP_OUT, { force: true });
  await rm(CHUNKS_DIR, { recursive: true, force: true });
}

export function validateMetafile(metafile) {
  const outputs = metafile.outputs;
  const entryKey = Object.keys(outputs).find((key) => {
    const output = outputs[key];
    return output.entryPoint && normalizePath(output.entryPoint).endsWith("src/pi/index.ts");
  });

  if (!entryKey) {
    throw new Error("esbuild metafile is missing the Pi entry output for src/pi/index.ts");
  }

  const heavyStaticOutputs = [];
  for (const outputKey of collectStaticOutputKeys(entryKey, outputs)) {
    const heavyInputs = listHeavyInputs(outputs[outputKey]);
    if (heavyInputs.length > 0) {
      heavyStaticOutputs.push({ output: outputKey, heavyInputs });
    }
  }

  if (heavyStaticOutputs.length > 0) {
    throw new Error(
      [
        "Pi entry topology regression: static entry graph contains heavy inputs.",
        ...heavyStaticOutputs.map((item) => `- ${item.output} (heavy: ${item.heavyInputs.join(", ")})`),
      ].join("\n"),
    );
  }

  // Ban host-package runtime external edges from every generated Pi entry JS output
  // (static entry and lazy chunks). Native ESM does not inherit Pi jiti aliases, so any
  // remaining external edge would reintroduce dual host-package loads.
  const hostExternalEdges = [];
  for (const [outputKey, output] of Object.entries(outputs)) {
    if (!normalizePath(outputKey).endsWith(".js")) continue;

    for (const edge of output.imports ?? []) {
      if (!edge.external) continue;
      if (isHostPackagePath(edge.path)) {
        hostExternalEdges.push({ output: outputKey, path: edge.path, kind: edge.kind });
      }
    }
  }

  if (hostExternalEdges.length > 0) {
    throw new Error(
      [
        "Pi entry topology regression: generated output has Pi host-package runtime external edge.",
        ...hostExternalEdges.map((item) => `- ${item.output} --${item.kind}--> ${item.path}`),
      ].join("\n"),
    );
  }
}

function isHostPackagePath(importPath) {
  return PI_HOST_PACKAGES.some((pkg) => importPath === pkg || importPath.startsWith(`${pkg}/`));
}

function collectStaticOutputKeys(entryKey, outputs) {
  const visited = new Set();
  const pending = [entryKey];

  while (pending.length > 0) {
    const outputKey = pending.pop();
    if (!outputKey || visited.has(outputKey)) continue;
    visited.add(outputKey);

    for (const edge of outputs[outputKey]?.imports ?? []) {
      if (edge.external || edge.kind === "dynamic-import") continue;
      const dependencyKey = resolveOutputKey(outputKey, edge.path, outputs);
      if (dependencyKey && !visited.has(dependencyKey)) pending.push(dependencyKey);
    }
  }

  return visited;
}

function listHeavyInputs(output) {
  const hits = new Set();
  for (const inputPath of Object.keys(output.inputs ?? {})) {
    const normalized = normalizePath(inputPath);
    for (const marker of HEAVY_INPUT_MARKERS) {
      if (normalized.includes(marker)) hits.add(marker);
    }
  }

  for (const edge of output.imports ?? []) {
    if (edge.kind === "dynamic-import") continue;
    const edgePath = normalizePath(edge.path ?? "");
    if (edgePath === "node:sqlite" || edgePath.includes("node:sqlite")) hits.add("node:sqlite");
    if (edgePath.includes("node_modules/effect/") || edgePath.startsWith("effect/")) hits.add("effect");
    if (edgePath === "ws" || edgePath.includes("node_modules/ws/")) hits.add("ws");
    if (
      edgePath.includes("node_modules/@earendil-works/pi-tui/") ||
      edgePath === "@earendil-works/pi-tui" ||
      edgePath.startsWith("@earendil-works/pi-tui/")
    ) {
      hits.add("pi-tui");
    }
  }

  return [...hits];
}

function resolveOutputKey(fromKey, importPath, outputs) {
  if (outputs[importPath]) return importPath;

  const fromDir = dirname(resolve(REPO_ROOT, fromKey));
  const absolute = resolve(fromDir, importPath);
  const relativeKey = normalizePath(relative(REPO_ROOT, absolute));
  if (outputs[relativeKey]) return relativeKey;

  // esbuild may use absolute or slightly different separators.
  for (const key of Object.keys(outputs)) {
    if (normalizePath(key) === relativeKey) return key;
    if (resolve(REPO_ROOT, key) === absolute) return key;
  }
  return undefined;
}

async function validateOutputSizes() {
  await access(ENTRY_OUT);
  const entryBytes = (await stat(ENTRY_OUT)).size;
  if (entryBytes > MAX_ENTRY_BYTES) {
    throw new Error(
      `Pi entry too large: ${entryBytes} bytes > ${MAX_ENTRY_BYTES} bytes (${relative(REPO_ROOT, ENTRY_OUT)})`,
    );
  }

  let totalBytes = entryBytes;
  try {
    const chunkNames = await readdir(CHUNKS_DIR);
    for (const name of chunkNames) {
      if (!name.endsWith(".js")) continue;
      totalBytes += (await stat(join(CHUNKS_DIR, name))).size;
    }
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code !== "ENOENT") {
      throw error;
    }
  }

  if (totalBytes > MAX_TOTAL_PI_ENTRY_BYTES) {
    throw new Error(`Pi entry outputs too large in total: ${totalBytes} bytes > ${MAX_TOTAL_PI_ENTRY_BYTES} bytes`);
  }

  console.log(
    `Pi entry size: entry=${entryBytes}B total=${totalBytes}B (limits ${MAX_ENTRY_BYTES}/${MAX_TOTAL_PI_ENTRY_BYTES})`,
  );
}

function normalizePath(value) {
  return value.replaceAll("\\", "/");
}

function isExecutedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return resolve(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isExecutedDirectly()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
