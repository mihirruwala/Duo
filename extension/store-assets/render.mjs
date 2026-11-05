#!/usr/bin/env node
/**
 * Renders the Chrome Web Store images for DUO Control into extension/store-assets/out/:
 *   screenshot-1..3.png (1280×800), promo-small.png (440×280), icon-128.png (96 px art, 16 px padding).
 *
 * The screenshots are real ones from the remote-control E2E test. Capture them first:
 *   DUO_SHOTS=$PWD/extension/store-assets/out/raw npx playwright test tests/e2e/control.spec.ts -g approve
 * then: node extension/store-assets/render.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "out");
const dataUri = (p) => `data:image/png;base64,${readFileSync(p).toString("base64")}`;
const icon = dataUri(join(here, "..", "icons", "128.png"));

const BASE = `
  * { box-sizing: border-box; margin: 0; }
  body { font-family: -apple-system, "Segoe UI", system-ui, sans-serif; color: #fff4e6; }
  .bg { background: radial-gradient(60rem 40rem at 10% -10%, rgba(255,138,110,.18), transparent 60%),
                    radial-gradient(50rem 40rem at 110% 10%, rgba(165,147,255,.2), transparent 60%), #120e18; }
`;

const SHOTS = [
  {
    raw: "ctl-approve.png",
    title: "Nothing happens until you say yes",
    body: "Your person asks, you approve or deny. Only the one tab you shared, never anything else.",
  },
  {
    raw: "ctl-owner.png",
    title: "You always know who's in control",
    body: "A banner with a countdown and Revoke one click away. ⇧⌘9 stops it from anywhere.",
  },
  {
    raw: "ctl-guest.png",
    title: "Click, scroll and type in their tab",
    body: "Help with a form, a setting or a site while you talk, from wherever you are.",
  },
];

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });

for (const [i, s] of SHOTS.entries()) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.setContent(`<!doctype html><style>${BASE}
    .wrap { width: 1280px; height: 800px; padding: 44px 80px 0; display: flex; flex-direction: column; align-items: center; overflow: hidden; }
    h1 { font-size: 40px; font-weight: 800; letter-spacing: -0.02em; text-align: center; }
    p { margin-top: 10px; font-size: 20px; color: #c9bfd2; text-align: center; max-width: 900px; }
    img { margin-top: 32px; width: 1120px; border-radius: 22px; box-shadow: 0 30px 80px rgba(0,0,0,.55); border: 1px solid rgba(255,255,255,.08); }
  </style><div class="wrap bg"><h1>${s.title}</h1><p>${s.body}</p><img src="${dataUri(join(out, "raw", s.raw))}"></div>`);
  await page.screenshot({ path: join(out, `screenshot-${i + 1}.png`) });
}

await page.setViewportSize({ width: 440, height: 280 });
await page.setContent(`<!doctype html><style>${BASE}
  .wrap { width: 440px; height: 280px; display: flex; flex-direction: column; justify-content: center; padding: 0 36px; gap: 14px; }
  .row { display: flex; align-items: center; gap: 14px; }
  img { width: 56px; height: 56px; }
  b { font-size: 30px; font-weight: 800; letter-spacing: -0.02em; }
  p { font-size: 19px; line-height: 1.3; color: #c9bfd2; }
</style><div class="wrap bg"><div class="row"><img src="${icon}"><b>DUO Control</b></div>
<p>Let the person you're on a call with use one of your tabs. Only after you say yes.</p></div>`);
await page.screenshot({ path: join(out, "promo-small.png") });

await page.setViewportSize({ width: 128, height: 128 });
await page.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}
  img{position:absolute;left:16px;top:16px;width:96px;height:96px}</style><img src="${icon}">`);
await page.screenshot({ path: join(out, "icon-128.png"), omitBackground: true });

await browser.close();
console.log(`Store images → ${out}`);
