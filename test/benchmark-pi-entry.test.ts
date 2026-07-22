// ABOUTME: Covers benchmark-pi-entry CLI argument parsing for --loader/--entry/--runs.
// ABOUTME: Ensures relative loader paths resolve and missing values fail closed.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
// Compiled tests live under dist/test; the script stays at the repo root scripts/.
const BENCHMARK_SCRIPT = join(TEST_DIR, "../../scripts/benchmark-pi-entry.mjs");
const execFileAsync = promisify(execFile);

interface BenchmarkModule {
  parseArgs: (argv: string[]) => {
    entry: string;
    runs: number;
    worker: boolean;
    loader?: string;
  };
}

function isBenchmarkModule(value: unknown): value is BenchmarkModule {
  if (typeof value !== "object" || value === null) return false;
  return typeof Reflect.get(value, "parseArgs") === "function";
}

async function loadBenchmarkModule(): Promise<BenchmarkModule> {
  const loaded: unknown = await import(pathToFileURL(BENCHMARK_SCRIPT).href);
  assert.ok(isBenchmarkModule(loaded), "benchmark module missing parseArgs export");
  return loaded;
}

void test("parseArgs resolves relative entry and defaults runs", async () => {
  const { parseArgs } = await loadBenchmarkModule();
  const parsed = parseArgs(["--entry", "dist/src/pi/index.js"]);
  assert.equal(parsed.entry, resolve(process.cwd(), "dist/src/pi/index.js"));
  assert.equal(parsed.runs, 7);
  assert.equal(parsed.worker, false);
  assert.equal(parsed.loader, undefined);
});

void test("parseArgs resolves absolute and relative --loader paths", async () => {
  const { parseArgs } = await loadBenchmarkModule();
  const absoluteLoader = "/opt/pi/loader.js";
  const absolute = parseArgs(["--entry", "/tmp/entry.js", "--loader", absoluteLoader, "--runs", "5"]);
  assert.equal(absolute.loader, absoluteLoader);
  assert.equal(absolute.runs, 5);

  const relative = parseArgs(["--entry", "/tmp/entry.js", "--loader", "loaders/custom.js"]);
  assert.equal(relative.loader, resolve(process.cwd(), "loaders/custom.js"));
});

void test("parseArgs rejects missing loader value and unknown flags", async () => {
  const { parseArgs } = await loadBenchmarkModule();
  assert.throws(() => parseArgs(["--entry", "/tmp/entry.js", "--loader"]), /Missing value for --loader/);
  assert.throws(() => parseArgs(["--entry", "/tmp/entry.js", "--loader", "--runs", "3"]), /Missing value for --loader/);
  assert.throws(() => parseArgs(["--entry", "/tmp/entry.js", "--unknown"]), /Unknown argument/);
  assert.throws(() => parseArgs(["--entry", "/tmp/entry.js", "--runs", "2"]), /--runs must be an integer/);
  assert.throws(() => parseArgs([]), /Missing required --entry/);
});

void test("parseArgs accepts --worker mode", async () => {
  const { parseArgs } = await loadBenchmarkModule();
  const parsed = parseArgs(["--worker", "--entry", "/tmp/entry.js", "--loader", "/tmp/loader.js"]);
  assert.equal(parsed.worker, true);
  assert.equal(parsed.entry, "/tmp/entry.js");
  assert.equal(parsed.loader, "/tmp/loader.js");
});

void test("benchmark passes an explicit loader path to fresh workers", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "pi entry benchmark "));
  const entryPath = join(tempDir, "sample entry.mjs");
  const loaderPath = join(tempDir, "sample loader.mjs");

  try {
    await writeFile(
      entryPath,
      [
        "// ABOUTME: Temporary extension entry for benchmark integration coverage.",
        "// ABOUTME: Exports a no-op factory loaded by the temporary Pi loader.",
        "export default function extensionFactory() {}",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      loaderPath,
      [
        "// ABOUTME: Temporary loader for benchmark worker propagation coverage.",
        "// ABOUTME: Imports the requested entry and returns Pi-compatible errors.",
        'import { pathToFileURL } from "node:url";',
        "export async function loadExtensions(paths) {",
        "  const loaded = await import(pathToFileURL(paths[0]).href);",
        '  return { errors: typeof loaded.default === "function" ? [] : [{ path: paths[0], error: "missing factory" }] };',
        "}",
      ].join("\n"),
      "utf8",
    );

    const { stdout } = await execFileAsync(
      process.execPath,
      [BENCHMARK_SCRIPT, "--entry", entryPath, "--loader", loaderPath, "--runs", "3"],
      { cwd: tempDir },
    );

    assert.match(stdout, new RegExp(`loader: ${escapeRegExp(loaderPath)}`));
    assert.match(stdout, /runs: 3/);
    assert.match(stdout, /median: \d+\.\d{2} ms/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
