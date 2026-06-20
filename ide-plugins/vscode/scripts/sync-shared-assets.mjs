// ABOUTME: Synchronizes shared repository icons into the VS Code extension package.
// ABOUTME: Keeps marketplace assets aligned with the root project branding files.
import { mkdirSync, copyFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const extensionDir = dirname(scriptDir);
const repoRoot = dirname(dirname(extensionDir));

/** @type {Array<{ source: string; destination: string }>} */
const assets = [
  {
    source: join(repoRoot, "assets/icons/icon-mark-128.png"),
    destination: join(extensionDir, "assets/icons/icon-mark-128.png"),
  },
  {
    source: join(repoRoot, "assets/icons/icon-128-black.png"),
    destination: join(extensionDir, "assets/icons/icon-light.png"),
  },
  {
    source: join(repoRoot, "assets/icons/icon-128.png"),
    destination: join(extensionDir, "assets/icons/icon-dark.png"),
  },
];

/**
 * @param {string} source
 * @param {string} destination
 */
function filesMatch(source, destination) {
  if (!existsSync(destination)) {
    return false;
  }

  return readFileSync(source).equals(readFileSync(destination));
}

for (const { source, destination } of assets) {
  if (!existsSync(source)) {
    throw new Error(`Shared asset does not exist: ${source}`);
  }

  mkdirSync(dirname(destination), { recursive: true });

  if (filesMatch(source, destination)) {
    console.log(`asset up to date: ${destination}`);
    continue;
  }

  copyFileSync(source, destination);
  console.log(`copied shared asset: ${source} -> ${destination}`);
}
