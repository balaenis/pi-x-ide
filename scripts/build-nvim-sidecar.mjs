import { chmod, mkdir } from "node:fs/promises";
import * as esbuild from "esbuild";

const production = process.argv.includes("--production");
const outfile = "nvim/bin/pi-x-ide-nvim-sidecar.cjs";

await mkdir("nvim/bin", { recursive: true });

await esbuild.build({
  entryPoints: ["src/nvim/sidecar.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node26",
  outfile,
  sourcemap: !production,
  minify: production,
  sourcesContent: false,
});

await chmod(outfile, 0o755).catch(() => undefined);
