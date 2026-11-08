#!/usr/bin/env node
/**
 * Renders DUO's app icons from src/app/icon.svg (run after changing the logo):
 *   public/icons/icon-192.png, icon-512.png   standard (rounded square, transparent corners)
 *   public/icons/maskable-512.png             full-bleed, logo inside the 80 % safe zone (Android crops it)
 *   src/app/apple-icon.png                    180 px, full-bleed (iOS rounds the corners itself)
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const svg = readFileSync(join(root, "src/app/icon.svg"), "utf8");
// The two-circle mark without its rounded background, for full-bleed icons.
const mark = svg.replace(/<rect width="48" height="48"[^>]*\/>/, "").replace('viewBox="0 0 48 48"', 'viewBox="0 8 48 32"');

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
async function render(size, html, out, transparent) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<!doctype html><style>html,body{margin:0;width:${size}px;height:${size}px;overflow:hidden;background:transparent}</style>${html}`,
  );
  await page.screenshot({ path: join(root, out), omitBackground: transparent });
}
const standard = (size) =>
  `<div style="width:${size}px;height:${size}px">${svg.replace("<svg ", `<svg width="${size}" height="${size}" `)}</div>`;
const fullBleed = (size, markWidth) =>
  `<div style="width:${size}px;height:${size}px;background:#1a1420;display:flex;align-items:center;justify-content:center">${mark.replace(
    "<svg ",
    `<svg width="${markWidth}" height="${(markWidth * 32) / 48}" `,
  )}</div>`;

await render(192, standard(192), "public/icons/icon-192.png", true);
await render(512, standard(512), "public/icons/icon-512.png", true);
await render(512, fullBleed(512, 330), "public/icons/maskable-512.png", false);
await render(180, fullBleed(180, 132), "src/app/apple-icon.png", false);
await browser.close();
console.log("App icons rendered.");
