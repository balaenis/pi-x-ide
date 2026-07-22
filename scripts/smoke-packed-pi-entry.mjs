// ABOUTME: Packs the npm package and verifies the Pi entry plus every lazy chunk loads.
// ABOUTME: Uses Pi's extension loader against the extracted tarball layout.
import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");

async function main() {
  const tempRoot = await mkdtemp(join(tmpdir(), "pi-x-ide-pack-smoke-"));
  try {
    const tarball = await runPack(tempRoot);
    const extractDir = join(tempRoot, "extract");
    await mkdir(extractDir, { recursive: true });
    await extractTarball(tarball, extractDir);

    const packageRoot = join(extractDir, "package");
    const entry = join(packageRoot, "dist/src/pi/index.js");
    await access(entry);

    const entrySource = await readFile(entry, "utf8");
    const chunkRefs = collectChunkRefs(entrySource);
    const chunksDir = join(packageRoot, "dist/src/pi/chunks");
    const allJsFiles = [entry];
    try {
      const names = await readdir(chunksDir);
      for (const name of names) {
        if (name.endsWith(".js")) allJsFiles.push(join(chunksDir, name));
      }
    } catch {
      // No chunks directory is only valid when the entry has no chunk refs.
    }

    for (const file of allJsFiles) {
      const source = await readFile(file, "utf8");
      for (const ref of collectChunkRefs(source)) {
        chunkRefs.add(ref);
      }
    }

    for (const ref of chunkRefs) {
      const absolute = resolve(dirname(entry), ref);
      try {
        await access(absolute);
      } catch {
        throw new Error(`Missing packed chunk referenced by entry graph: ${ref}`);
      }
      // Native-import every lazy chunk to force host/dependency resolution.
      await import(pathToFileURL(absolute).href);
    }

    // Load the packed entry through Pi's real extension loader.
    // Package exports block deep subpaths; resolve via package main sibling path.
    const packageMain = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
    const loaderPath = join(dirname(packageMain), "core/extensions/loader.js");
    const { loadExtensions } = await import(pathToFileURL(loaderPath).href);
    const result = await loadExtensions([entry], packageRoot);
    if (result.errors.length > 0) {
      const details = result.errors.map((item) => `${item.path}: ${item.error}`).join("; ");
      throw new Error(`Packed entry failed to load via Pi loader: ${details}`);
    }

    const metafileHits = await findFiles(join(packageRoot, "dist/src/pi"), (name) => name.includes("metafile"));
    if (metafileHits.length > 0) {
      throw new Error(`Packed package includes metafile artifact(s): ${metafileHits.join(", ")}`);
    }

    console.log(`Packed Pi entry smoke passed (${chunkRefs.size} chunk(s), entry=${relative(packageRoot, entry)})`);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function collectChunkRefs(source) {
  const refs = new Set();
  const patterns = [
    /(?:import|export)[^'";]*["'](\.?\.?\/chunks\/[^"']+\.js)["']/g,
    /import\(\s*["'](\.?\.?\/chunks\/[^"']+\.js)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source)) !== null) {
      refs.add(match[1]);
    }
  }
  return refs;
}

async function runPack(tempRoot) {
  // prepack rebuilds dist; pack into the temp directory.
  await runCommand("bun", ["pm", "pack", "--destination", tempRoot], REPO_ROOT);
  const files = await readdir(tempRoot);
  const tarballName = files.find((name) => name.endsWith(".tgz"));
  if (!tarballName) {
    throw new Error(`bun pm pack did not produce a tarball in ${tempRoot}`);
  }
  return join(tempRoot, tarballName);
}

async function extractTarball(tarball, extractDir) {
  await runCommand("tar", ["-xzf", tarball, "-C", extractDir], REPO_ROOT);
}

async function findFiles(root, predicate) {
  const hits = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (predicate(entry.name)) {
        hits.push(full);
      }
    }
  }
  await walk(root);
  return hits;
}

function runCommand(command, args, cwd) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
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
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise({ stdout, stderr });
        return;
      }
      rejectPromise(new Error(`${command} ${args.join(" ")} failed (${code}): ${stderr.trim() || stdout.trim()}`));
    });
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
