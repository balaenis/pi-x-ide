// ABOUTME: Benchmarks Pi extension entry import+factory cost via Pi's real loader.
// ABOUTME: Spawns a fresh Node process per sample and reports median/min/max timings.
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { constants as fsConstants } from "node:fs";

const DEFAULT_RUNS = 7;
const MIN_RUNS = 3;

async function main(argv) {
  const options = parseArgs(argv);
  if (options.worker) {
    await runWorker(options.entry);
    return;
  }
  await runParent(options);
}

function parseArgs(argv) {
  let entry;
  let runs = DEFAULT_RUNS;
  let worker = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--worker") {
      worker = true;
      continue;
    }
    if (arg === "--entry") {
      entry = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--runs") {
      const raw = argv[index + 1];
      index += 1;
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed < MIN_RUNS) {
        throw new Error(`--runs must be an integer >= ${MIN_RUNS}, got ${raw ?? "<missing>"}`);
      }
      runs = parsed;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!entry) {
    throw new Error("Missing required --entry <path>");
  }

  const resolvedEntry = isAbsolute(entry) ? entry : resolve(process.cwd(), entry);
  return { entry: resolvedEntry, runs, worker };
}

async function resolveLoadExtensions() {
  // Public package entry does not re-export loadExtensions in 0.80.1, and package
  // exports block deep subpath imports. Resolve the package main, then load the
  // sibling loader module by absolute file URL.
  const packageMain = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
  const loaderPath = join(dirname(packageMain), "core/extensions/loader.js");
  return import(pathToFileURL(loaderPath).href);
}

async function runWorker(entry) {
  await assertEntryExists(entry);

  const { loadExtensions } = await resolveLoadExtensions();

  const started = performance.now();
  const result = await loadExtensions([entry], process.cwd());
  const elapsedMs = performance.now() - started;

  if (result.errors.length > 0) {
    const details = result.errors.map((item) => `${item.path}: ${item.error}`).join("; ");
    throw new Error(`Extension load errors: ${details}`);
  }

  process.stdout.write(`${JSON.stringify({ elapsedMs })}\n`);
  // Exit immediately so factory preload promises cannot keep the worker alive
  // or extend the measured import+factory interval.
  process.exit(0);
}

async function runParent(options) {
  await assertEntryExists(options.entry);

  const samples = [];
  for (let run = 0; run < options.runs; run += 1) {
    const sample = await spawnWorkerSample(options.entry);
    samples.push(sample);
  }

  const sorted = [...samples].sort((left, right) => left - right);
  const summary = {
    entry: options.entry,
    runs: options.runs,
    medianMs: median(sorted),
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
    samplesMs: samples,
  };

  process.stdout.write(
    [
      `entry: ${summary.entry}`,
      `runs: ${summary.runs}`,
      `median: ${formatMs(summary.medianMs)} ms`,
      `min: ${formatMs(summary.minMs)} ms`,
      `max: ${formatMs(summary.maxMs)} ms`,
      `samples: ${summary.samplesMs.map(formatMs).join(", ")}`,
    ].join("\n") + "\n",
  );
}

function spawnWorkerSample(entry) {
  return new Promise((resolveSample, rejectSample) => {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--worker", "--entry", entry], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", rejectSample);
    child.on("close", (code) => {
      if (code !== 0) {
        rejectSample(
          new Error(
            `Worker exited with code ${code ?? "null"}${stderr.trim() ? `: ${stderr.trim()}` : ""}${
              stdout.trim() ? ` (stdout: ${stdout.trim()})` : ""
            }`,
          ),
        );
        return;
      }

      const line = stdout
        .split(/\r?\n/)
        .map((part) => part.trim())
        .find((part) => part.length > 0);
      if (!line) {
        rejectSample(new Error("Worker produced no JSON output"));
        return;
      }

      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch (error) {
        rejectSample(
          new Error(`Worker produced invalid JSON: ${error instanceof Error ? error.message : String(error)}`),
        );
        return;
      }

      if (typeof parsed.elapsedMs !== "number" || !Number.isFinite(parsed.elapsedMs)) {
        rejectSample(new Error(`Worker JSON missing numeric elapsedMs: ${line}`));
        return;
      }

      resolveSample(parsed.elapsedMs);
    });
  });
}

async function assertEntryExists(entry) {
  try {
    await access(entry, fsConstants.F_OK);
  } catch {
    throw new Error(`Entry not found: ${entry}`);
  }
}

function median(sorted) {
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}

function formatMs(value) {
  return value.toFixed(2);
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
