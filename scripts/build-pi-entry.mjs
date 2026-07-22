// ABOUTME: Bundles the Pi extension entry with esbuild code-splitting for fast startup.
// ABOUTME: Validates entry topology/size so Effect stays off the static shell import graph.
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

const PI_HOST_PACKAGES = ["@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"];
const HEAVY_INPUT_MARKERS = ["node_modules/effect/", "node_modules/ws/", "node:sqlite"];
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
    external: [...PI_HOST_PACKAGES],
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

function validateMetafile(metafile) {
  const outputs = metafile.outputs;
  const entryKey = Object.keys(outputs).find((key) => {
    const output = outputs[key];
    return output.entryPoint && normalizePath(output.entryPoint).endsWith("src/pi/index.ts");
  });

  if (!entryKey) {
    throw new Error("esbuild metafile is missing the Pi entry output for src/pi/index.ts");
  }

  const entryOutput = outputs[entryKey];
  const heavyStaticEdges = [];

  for (const edge of entryOutput.imports ?? []) {
    if (edge.external) continue;
    if (edge.kind !== "import-statement") continue;

    const depKey = resolveOutputKey(entryKey, edge.path, outputs);
    if (!depKey) continue;
    const depOutput = outputs[depKey];
    if (!depOutput) continue;

    if (outputHasHeavyInputs(depOutput, metafile)) {
      heavyStaticEdges.push({
        from: entryKey,
        to: depKey,
        kind: edge.kind,
        heavyInputs: listHeavyInputs(depOutput, metafile),
      });
    }
  }

  if (heavyStaticEdges.length > 0) {
    throw new Error(
      [
        "Pi entry topology regression: static entry imports a heavy chunk.",
        ...heavyStaticEdges.map(
          (edge) => `- ${edge.from} --${edge.kind}--> ${edge.to} (heavy: ${edge.heavyInputs.join(", ")})`,
        ),
      ].join("\n"),
    );
  }

  const hostExternalInChunks = [];
  for (const [outputKey, output] of Object.entries(outputs)) {
    if (outputKey === entryKey) continue;
    if (!normalizePath(outputKey).includes("/chunks/")) continue;

    for (const edge of output.imports ?? []) {
      if (!edge.external) continue;
      if (PI_HOST_PACKAGES.some((pkg) => edge.path === pkg || edge.path.startsWith(`${pkg}/`))) {
        hostExternalInChunks.push({ chunk: outputKey, path: edge.path });
      }
    }
  }

  if (hostExternalInChunks.length > 0) {
    throw new Error(
      [
        "Pi entry topology regression: lazy chunk has Pi host-package external edge.",
        ...hostExternalInChunks.map((item) => `- ${item.chunk} -> ${item.path}`),
      ].join("\n"),
    );
  }
}

function outputHasHeavyInputs(output, metafile) {
  return listHeavyInputs(output, metafile).length > 0;
}

function listHeavyInputs(output, metafile) {
  const hits = new Set();
  for (const inputPath of Object.keys(output.inputs ?? {})) {
    const normalized = normalizePath(inputPath);
    for (const marker of HEAVY_INPUT_MARKERS) {
      if (normalized.includes(marker)) hits.add(marker);
    }

    const inputMeta = metafile.inputs[inputPath];
    for (const edge of inputMeta?.imports ?? []) {
      const edgePath = normalizePath(edge.path ?? "");
      if (edgePath === "node:sqlite" || edgePath.includes("node:sqlite")) {
        hits.add("node:sqlite");
      }
      if (edgePath.includes("node_modules/effect/") || edgePath.startsWith("effect/")) {
        hits.add("effect");
      }
      if (edgePath === "ws" || edgePath.includes("node_modules/ws/")) {
        hits.add("ws");
      }
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

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
