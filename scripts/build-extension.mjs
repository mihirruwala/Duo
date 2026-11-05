#!/usr/bin/env node
/**
 * Builds the DUO Control extension into extension/dist (or extension/dist-e2e with --e2e).
 *
 *   DUO_EXTENSION_ORIGINS="https://duo.example.com" npm run ext:build
 *
 * The manifest's externally_connectable list is generated from DUO_EXTENSION_ORIGINS (comma
 * separated, exact origins, no wildcards). Defaults to the local dev origins.
 * --e2e compiles in test-only hooks; never load that build in a real browser profile.
 * --store builds for the Chrome Web Store: production origins only, no "key" (the store assigns the
 * ID and rejects manifests that carry one), and zips the result to extension/duo-control-<version>.zip.
 */
import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const e2e = process.argv.includes("--e2e");
const store = process.argv.includes("--store");
if (e2e && store) throw new Error("--e2e and --store can't be combined");
const out = join(root, "extension", e2e ? "dist-e2e" : store ? "dist-store" : "dist");
const VERSION = "1.0.0";

const origins = (process.env.DUO_EXTENSION_ORIGINS || "http://localhost:3000,http://localhost:3001")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean)
  .map((o) => {
    const u = new URL(o);
    if (u.origin !== o.replace(/\/$/, "")) throw new Error(`Not a bare origin: ${o}`);
    if (u.protocol !== "https:" && u.hostname !== "localhost" && u.hostname !== "127.0.0.1") {
      throw new Error(`Only https origins (or localhost) are allowed: ${o}`);
    }
    return u.origin;
  });
if (store) {
  if (!process.env.DUO_EXTENSION_ORIGINS) throw new Error("--store needs DUO_EXTENSION_ORIGINS (the production site)");
  const local = origins.filter((o) => !o.startsWith("https:"));
  if (local.length) throw new Error(`A store build must only allow https origins, not ${local.join(", ")}`);
}
if (e2e && !origins.some((o) => o.includes(":3100"))) origins.push("http://localhost:3100", "http://localhost:3200");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: { background: join(root, "extension/src/background.ts"), popup: join(root, "extension/src/popup.ts") },
  outdir: out,
  bundle: true,
  format: "esm",
  target: "chrome116",
  minify: !e2e,
  legalComments: "none",
  define: { __DUO_ORIGINS__: JSON.stringify(origins), __DUO_E2E__: String(e2e) },
  logLevel: "warning",
});

const manifest = {
  manifest_version: 3,
  name: e2e ? "DUO Control (E2E)" : "DUO Control",
  version: VERSION,
  description: "Lets the person you're on a DUO call with control one tab you share, only after you approve.",
  minimum_chrome_version: "116",
  // The key pins the unpacked extension's ID for development; the Web Store assigns its own.
  ...(store ? {} : { key: readFileSync(join(root, "extension/manifest-key.txt"), "utf8").trim() }),
  // Least privilege: no host permissions, no "tabs" (activeTab covers the one tab you pick).
  //  - debugger: inject trusted input into the shared tab (see docs/EXTENSION.md)
  //  - tabCapture: stream exactly that tab to DUO
  //  - activeTab: temporary access to the tab you clicked the extension on
  //  - notifications: approval prompt when DUO isn't in front
  permissions: ["debugger", "tabCapture", "activeTab", "notifications"],
  background: { service_worker: "background.js", type: "module" },
  action: {
    default_popup: "popup.html",
    default_title: "DUO Control",
    default_icon: { 16: "icons/16.png", 32: "icons/32.png", 48: "icons/48.png" },
  },
  icons: { 16: "icons/16.png", 48: "icons/48.png", 128: "icons/128.png" },
  commands: {
    "emergency-stop": {
      suggested_key: { default: "Ctrl+Shift+9", mac: "Command+Shift+9" },
      description: "Emergency stop: end remote control immediately",
      global: true,
    },
  },
  externally_connectable: { matches: origins.map((o) => `${o}/*`) },
};
writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2));
cpSync(join(root, "extension/popup.html"), join(out, "popup.html"));
cpSync(join(root, "extension/popup.css"), join(out, "popup.css"));
cpSync(join(root, "extension/icons"), join(out, "icons"), { recursive: true });

if (store) {
  const zip = join(root, "extension", `duo-control-${VERSION}.zip`);
  rmSync(zip, { force: true });
  execFileSync("zip", ["-qrX", zip, "."], { cwd: out });
  console.log(`Store package → ${zip}`);
}
console.log(`Built ${e2e ? "E2E " : store ? "store " : ""}extension → ${out}\nAllowed DUO origins: ${origins.join(", ")}`);
