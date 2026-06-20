// ABOUTME: Builds the Neovim sidecar bundle and standalone binaries.
// ABOUTME: Writes generated artifacts into the Neovim IDE plugin directory.
import { chmod, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import * as esbuild from "esbuild";

const production = process.argv.includes("--production");
const cjsOutfile = "ide-plugins/nvim/bin/pi-x-ide-nvim-sidecar.cjs";
const outdir = "ide-plugins/nvim/bin";
/** TypeScript entry point (used for both CJS bundle and direct binary compilation). */
const entryPoint = "src/nvim/sidecar.ts";

/** Platform targets for bun build --compile */
const TARGETS = ["bun-linux-x64", "bun-linux-arm64", "bun-darwin-x64", "bun-darwin-arm64", "bun-windows-x64"];

await mkdir(outdir, { recursive: true });

// ── CJS bundle (Node.js fallback) ────────────────────────────────

await esbuild.build({
  entryPoints: [entryPoint],
  banner: {
    js: "// ABOUTME: Bundles the Neovim sidecar runtime for plugin-managed execution.\n// ABOUTME: Bridges Neovim stdin messages to Pi through the shared IDE protocol.",
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node26",
  outfile: cjsOutfile,
  sourcemap: !production,
  minify: production,
  sourcesContent: false,
});

await chmod(cjsOutfile, 0o755).catch(() => undefined);

// ── Standalone binaries (bun build --compile from TS source) ─────
// NOTE: compiling the esbuild CJS bundle with bun produces broken
// binaries (TCP accepts but HTTP/WS never responds). Compile from
// TypeScript source directly instead.

const compileAll = process.argv.includes("--target=all");
const targetsToBuild = compileAll ? TARGETS : [currentBunTarget()].filter(Boolean);

if (targetsToBuild.length === 0) {
  console.warn("  ⚠  Could not detect current bun target — skipping binary compilation.");
} else {
  const bunAvailable = await isBunAvailable();
  if (!bunAvailable) {
    console.warn("  ⚠  bun not found on PATH — skipping binary compilation.");
  } else {
    for (const target of targetsToBuild) {
      await compileBinary({ entry: entryPoint, target });
    }
  }
}

// ── helpers ──────────────────────────────────────────────────────

/**
 * Compile a single platform binary with `bun build --compile`.
 * Uses the TypeScript source as entry point (NOT the esbuild CJS
 * bundle, which produces broken binaries when compiled with bun).
 */
async function compileBinary({ entry, target }) {
  const ext = target.includes("windows") ? ".exe" : "";
  const name = `pi-x-ide-nvim-sidecar-${target.replace("bun-", "")}${ext}`;
  const out = `${outdir}/${name}`;

  console.log(`  compiling ${target} → ${out} …`);
  const start = Date.now();

  await new Promise((resolve, reject) => {
    const child = spawn("bun", ["build", "--compile", `--target=${target}`, entry, "--outfile", out], {
      stdio: "inherit",
    });
    child.on("close", (code) => {
      if (code === 0) {
        console.log(`    done in ${((Date.now() - start) / 1000).toFixed(1)}s`);
        resolve();
      } else {
        reject(new Error(`bun build --compile exited with code ${code}`));
      }
    });
    child.on("error", reject);
  });

  await chmod(out, 0o755).catch(() => undefined);
}

/**
 * Map the current machine to a bun target triple.
 */
function currentBunTarget() {
  const { arch, platform } = process;
  const map = {
    "linux-x64": "bun-linux-x64",
    "linux-arm64": "bun-linux-arm64",
    "darwin-x64": "bun-darwin-x64",
    "darwin-arm64": "bun-darwin-arm64",
    "win32-x64": "bun-windows-x64",
  };
  return map[`${platform}-${arch}`] ?? null;
}

/**
 * Check whether `bun` is available on PATH.
 */
async function isBunAvailable() {
  try {
    await new Promise((resolve, _reject) => {
      const child = spawn("bun", ["--version"], { stdio: "ignore" });
      child.on("close", (code) => resolve(code === 0));
      child.on("error", () => resolve(false));
      return undefined;
    });
    return true;
  } catch {
    return false;
  }
}
