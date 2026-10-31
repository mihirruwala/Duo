"use client";

/**
 * Original vector art for face filters, rasterized once to ImageBitmaps on the main thread
 * (workers can't decode SVG) and transferred to the Studio worker.
 */
const INK = "#1a1420";
const svg = (w: number, h: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;

const ear = (fill: string, inner: string) =>
  svg(
    200,
    260,
    `<path d="M100 10 C40 30 10 120 30 230 C60 250 110 240 150 200 C190 140 170 40 100 10Z" fill="${fill}" stroke="${INK}" stroke-width="8"/><path d="M98 50 C60 70 50 140 64 205 C90 210 115 196 135 170 C150 120 140 70 98 50Z" fill="${inner}"/>`,
  );

const catEar = (fill: string) =>
  svg(
    200,
    200,
    `<path d="M20 190 L70 15 L185 160 Z" fill="${fill}" stroke="${INK}" stroke-width="9" stroke-linejoin="round"/><path d="M55 160 L78 65 L140 145 Z" fill="#ffb3c7"/>`,
  );

export const SPRITE_SVGS: Record<string, string> = {
  sunglasses: svg(
    480,
    170,
    `<path d="M20 40 H460" stroke="${INK}" stroke-width="16" stroke-linecap="round"/>
     <path d="M40 40 h160 q10 0 8 12 l-12 70 q-6 32 -46 32 h-50 q-40 0 -52 -36 l-16 -66 q-2 -12 8 -12z" fill="#140f19"/>
     <path d="M280 40 h160 q10 0 8 12 l-16 66 q-12 36 -52 36 h-50 q-40 0 -46 -32 l-12 -70 q-2 -12 8 -12z" fill="#140f19"/>
     <path d="M70 62 l40 0 -30 50z M310 62 l40 0 -30 50z" fill="#fff" opacity=".35"/>
     <path d="M208 52 q32 -20 64 0" stroke="${INK}" stroke-width="12" fill="none"/>`,
  ),
  "big-glasses": svg(
    520,
    260,
    `<circle cx="140" cy="130" r="112" fill="#fff" stroke="#ff8a6e" stroke-width="22"/>
     <circle cx="380" cy="130" r="112" fill="#fff" stroke="#ff8a6e" stroke-width="22"/>
     <circle cx="160" cy="145" r="58" fill="${INK}"/><circle cx="360" cy="145" r="58" fill="${INK}"/>
     <circle cx="180" cy="122" r="18" fill="#fff"/><circle cx="380" cy="122" r="18" fill="#fff"/>
     <path d="M232 110 q28 -22 56 0" stroke="#ff8a6e" stroke-width="18" fill="none" stroke-linecap="round"/>`,
  ),
  "dog-ear-l": ear("#b9805a", "#e0a985"),
  "dog-ear-r": ear("#b9805a", "#e0a985")
    .replace("<path", '<g transform="translate(200 0) scale(-1 1)"><path')
    .replace("</svg>", "</g></svg>"),
  "dog-nose": svg(
    240,
    200,
    `<ellipse cx="120" cy="70" rx="90" ry="60" fill="#1f1714"/>
     <ellipse cx="95" cy="50" rx="26" ry="14" fill="#fff" opacity=".35"/>
     <path d="M120 128 v20" stroke="#1f1714" stroke-width="10"/>
     <path d="M88 150 q32 52 64 0 z" fill="#ff7aa2" stroke="${INK}" stroke-width="6"/>`,
  ),
  "cat-ear-l": catEar("#ffd36b"),
  "cat-ear-r": catEar("#ffd36b")
    .replace("<path", '<g transform="translate(200 0) scale(-1 1)"><path')
    .replace("</svg>", "</g></svg>"),
  "cat-whiskers": svg(
    520,
    180,
    `<path d="M240 70 l20 18 l20 -18z" fill="#ff7aa2" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
     <g stroke="${INK}" stroke-width="7" stroke-linecap="round" fill="none">
       <path d="M200 95 Q110 70 20 70"/><path d="M200 110 Q110 110 15 125"/><path d="M205 125 Q120 150 40 175"/>
       <path d="M320 95 Q410 70 500 70"/><path d="M320 110 Q410 110 505 125"/><path d="M315 125 Q400 150 480 175"/>
     </g>`,
  ),
  crown: svg(
    420,
    260,
    `<path d="M30 230 L40 70 L130 150 L210 30 L290 150 L380 70 L390 230 Z" fill="#ffd36b" stroke="${INK}" stroke-width="10" stroke-linejoin="round"/>
     <rect x="30" y="200" width="360" height="40" rx="10" fill="#ffb84d" stroke="${INK}" stroke-width="10"/>
     <circle cx="210" cy="140" r="22" fill="#ff8a6e" stroke="${INK}" stroke-width="7"/>
     <circle cx="110" cy="190" r="14" fill="#a593ff"/><circle cx="310" cy="190" r="14" fill="#7fe0c0"/>
     <circle cx="40" cy="70" r="16" fill="#ff8a6e" stroke="${INK}" stroke-width="7"/><circle cx="380" cy="70" r="16" fill="#ff8a6e" stroke="${INK}" stroke-width="7"/>
     <circle cx="210" cy="30" r="18" fill="#a593ff" stroke="${INK}" stroke-width="7"/>`,
  ),
  heart: svg(
    120,
    110,
    `<path d="M60 104 C18 74 4 48 14 28 C24 8 50 6 60 26 C70 6 96 8 106 28 C116 48 102 74 60 104Z" fill="#ff6b8b" stroke="${INK}" stroke-width="5"/>
     <ellipse cx="38" cy="34" rx="10" ry="6" fill="#fff" opacity=".5"/>`,
  ),
};

async function rasterize(markup: string, maxSide = 512): Promise<ImageBitmap> {
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  await img.decode();
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  return createImageBitmap(img, {
    resizeWidth: Math.round(img.naturalWidth * scale),
    resizeHeight: Math.round(img.naturalHeight * scale),
  });
}

let spritesPromise: Promise<Record<string, ImageBitmap>> | null = null;
export function loadSprites(): Promise<Record<string, ImageBitmap>> {
  spritesPromise ??= Promise.all(Object.entries(SPRITE_SVGS).map(async ([k, v]) => [k, await rasterize(v)] as const)).then(
    Object.fromEntries,
  );
  return spritesPromise;
}

let bgPromise: Promise<Record<string, ImageBitmap>> | null = null;
export function loadBackgrounds(ids: readonly string[]): Promise<Record<string, ImageBitmap>> {
  bgPromise ??= Promise.all(
    ids.map(async (id) => {
      const img = new Image();
      img.src = `/backgrounds/${id}.svg`;
      await img.decode();
      return [id, await createImageBitmap(img, { resizeWidth: 1280, resizeHeight: 720 })] as const;
    }),
  ).then(Object.fromEntries);
  return bgPromise;
}

/** Copies so each worker gets its own transferable set (transfer detaches the original). */
export async function cloneAll(set: Record<string, ImageBitmap>): Promise<Record<string, ImageBitmap>> {
  const out: Record<string, ImageBitmap> = {};
  await Promise.all(Object.entries(set).map(async ([k, b]) => (out[k] = await createImageBitmap(b))));
  return out;
}
