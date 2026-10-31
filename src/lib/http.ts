import "server-only";
import { NextResponse, type NextRequest } from "next/server";

export type ApiError = { error: string; message: string };

export function apiError(status: number, error: string, message: string, headers?: HeadersInit) {
  return NextResponse.json<ApiError>({ error, message }, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export function apiOk<T>(body: T) {
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}

/**
 * CSRF defence for cookie-authenticated mutations: the browser must tell us the request
 * came from our own origin. Fetch Metadata first, Origin header as fallback; a request
 * carrying neither is rejected.
 */
export function isSameOrigin(request: NextRequest): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  const origin = request.headers.get("origin");
  if (!origin) return false;
  return origin === request.nextUrl.origin;
}

export function clientIp(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}
