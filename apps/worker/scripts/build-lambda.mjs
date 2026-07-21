import { build } from "esbuild";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "dist-lambda");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await build({
  entryPoints: [resolve(root, "src/lambda-entry.ts")],
  outfile: resolve(output, "index.cjs"),
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  sourcemap: true,
  minify: false,
  legalComments: "none",
});
await build({
  entryPoints: [resolve(root, "src/notification-lambda-entry.ts")],
  outfile: resolve(output, "notification-index.cjs"),
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  sourcemap: true,
  minify: false,
  legalComments: "none",
});
