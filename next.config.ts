import type { NextConfig } from "next";

// CSP is set per request (with a nonce) in src/proxy.ts. These are the static headers.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  {
    key: "Permissions-Policy",
    value:
      'camera=(self), microphone=(self), display-capture=(self), fullscreen=(self "https://www.youtube-nocookie.com" "https://www.youtube.com"), geolocation=(), payment=(), usb=()',
  },
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
    : []),
];

const nextConfig: NextConfig = {
  // Cache Components is deliberately off: nonce-based CSP needs per-request rendering and
  // every DUO route is authenticated/per-user. See docs/ARCHITECTURE.md §6.
  poweredByHeader: false,
  reactStrictMode: true,
  turbopack: {
    root: import.meta.dirname,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // One official address: www.duoforyou.cv → duoforyou.cv (the vercel.app address keeps working,
  // because the published DUO Control extension and older invite links point there).
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.duoforyou.cv" }],
        destination: "https://duoforyou.cv/:path*",
        permanent: true,
      },
    ];
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
