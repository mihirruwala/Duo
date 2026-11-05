/**
 * Content-Security-Policy builder. Scripts are locked to a per-request nonce with
 * 'strict-dynamic'; 'wasm-unsafe-eval' is required for MediaPipe's WASM runtime. YouTube's player
 * API script (Watch Together) is added by our own code, so 'strict-dynamic' admits it.
 * style-src allows inline styles because Radix/LiveKit set style attributes; styles
 * cannot execute script, so the XSS surface stays closed.
 */
export function buildCsp(nonce: string, opts: { isDev: boolean }): string {
  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const livekit = process.env.NEXT_PUBLIC_LIVEKIT_URL ?? "";

  const connect = new Set<string>(["'self'"]);
  for (const url of [supabase, livekit]) {
    if (!url) continue;
    const u = new URL(url);
    const httpOrigin = `${u.protocol === "wss:" ? "https:" : u.protocol === "ws:" ? "http:" : u.protocol}//${u.host}`;
    const wsOrigin = `${httpOrigin.startsWith("https") ? "wss" : "ws"}://${u.host}`;
    connect.add(httpOrigin);
    connect.add(wsOrigin);
  }
  // LiveKit Cloud signals on *.livekit.cloud and may redirect to regional hosts.
  if (livekit.includes(".livekit.cloud")) {
    connect.add("https://*.livekit.cloud");
    connect.add("wss://*.livekit.cloud");
  }
  if (opts.isDev) connect.add("ws://localhost:*");

  const storageImg = supabase ? new URL(supabase).origin : "";

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      "'wasm-unsafe-eval'",
      ...(opts.isDev ? ["'unsafe-eval'"] : []),
    ],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "blob:", "data:", "https://media.giphy.com", "https://*.giphy.com", storageImg].filter(Boolean),
    "media-src": ["'self'", "blob:", "mediastream:", storageImg].filter(Boolean),
    "font-src": ["'self'"],
    "connect-src": [...connect],
    "worker-src": ["'self'", "blob:"],
    // Watch Together: YouTube's player frame (privacy-enhanced host). Nothing else may be framed.
    "frame-src": ["https://www.youtube-nocookie.com", "https://www.youtube.com"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  const policy = Object.entries(directives)
    .map(([k, v]) => `${k} ${v.join(" ")}`)
    .join("; ");
  const https = (process.env.NEXT_PUBLIC_SITE_URL ?? "").startsWith("https:");
  return https && !opts.isDev ? `${policy}; upgrade-insecure-requests` : policy;
}

export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}
