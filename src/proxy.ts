import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { buildCsp, generateNonce } from "@/lib/security/csp";

const PROTECTED_PREFIXES = ["/home", "/r/", "/settings"];
const AUTH_PAGES = ["/sign-in", "/sign-up"];

/**
 * Runs before every page request:
 *  1. issues a fresh CSP nonce (Next.js applies it to its own scripts automatically),
 *  2. refreshes the Supabase session cookie,
 *  3. performs optimistic auth redirects. Real authorization happens in RLS and route handlers.
 */
export default async function proxy(request: NextRequest) {
  const nonce = generateNonce();
  const csp = buildCsp(nonce, { isDev: process.env.NODE_ENV === "development" });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  let response = NextResponse.next({ request: { headers: requestHeaders } });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  let userId: string | null = null;

  if (url && key) {
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request: { headers: requestHeaders } });
          for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
          for (const [k, v] of Object.entries(headers ?? {})) response.headers.set(k, v);
        },
      },
    });
    const { data } = await supabase.auth.getClaims();
    userId = data?.claims?.sub ?? null;
  }

  const path = request.nextUrl.pathname;
  const redirectTo = (target: URL) => {
    const r = NextResponse.redirect(target);
    // Keep refreshed auth cookies on redirects too.
    for (const c of response.cookies.getAll()) r.cookies.set(c);
    return r;
  };

  if (!userId && PROTECTED_PREFIXES.some((p) => path === p || path.startsWith(p))) {
    const target = new URL("/sign-in", request.url);
    target.searchParams.set("next", path);
    response = redirectTo(target);
  } else if (userId && AUTH_PAGES.includes(path)) {
    response = redirectTo(new URL("/home", request.url));
  }

  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      source:
        "/((?!api|_next/static|_next/image|favicon.ico|icon.svg|robots.txt|sitemap.xml|opengraph-image|mediapipe|models|stickers|backgrounds|studio|livekit).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
