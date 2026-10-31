#!/usr/bin/env node
/**
 * DUO Studio assets, generated into public/ (gitignored) before dev and build:
 *  - public/mediapipe/*: MediaPipe WASM runtime copied from node_modules (self-hosted: CSP stays 'self')
 *  - public/studio/worker.js: the effects worker, bundled as a *classic* script, because MediaPipe's
 *    loader relies on importScripts, which module workers don't support.
 * Models (public/models) and backgrounds (public/backgrounds) are committed.
 */
import { build } from "esbuild";
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const wasmSrc = join(root, "node_modules/@mediapipe/tasks-vision/wasm");
const wasmOut = join(root, "public/mediapipe");
mkdirSync(wasmOut, { recursive: true });
for (const f of readdirSync(wasmSrc)) {
  // The *_module_* variants are for ES-module workers, which we don't use.
  if (f.includes("_module_")) continue;
  copyFileSync(join(wasmSrc, f), join(wasmOut, f));
}

await build({
  entryPoints: [join(root, "src/features/studio/worker/studio.worker.ts")],
  outfile: join(root, "public/studio/worker.js"),
  bundle: true,
  format: "iife",
  target: "chrome116",
  minify: process.env.NODE_ENV === "production" || process.argv.includes("--minify"),
  sourcemap: process.argv.includes("--minify") ? false : "inline",
  legalComments: "none",
  logLevel: "warning",
});
console.log("DUO Studio assets ready (public/mediapipe, public/studio/worker.js)");
