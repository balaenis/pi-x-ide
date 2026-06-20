// ABOUTME: Bundles the VS Code extension entry point with esbuild.
// ABOUTME: Produces the CommonJS extension artifact consumed by VS Code.
import * as esbuild from "esbuild";

const production = process.argv.includes("--production");

await esbuild.build({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  outfile: "out/extension.js",
  sourcemap: !production,
  minify: production,
  external: ["vscode"],
  sourcesContent: false,
});
