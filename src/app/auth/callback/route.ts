import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { log } from "@/lib/log";
import { safeNextPath } from "@/shared/invite";

/**
 * Email-confirmation landing (PKCE). Supabase redirects here with ?code=…, which we
 * exchange for a session cookie, then continue to a validated same-site path.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, origin));
    log.warn("auth.callback.exchange_failed", { error_code: error.code });
  }
  return NextResponse.redirect(new URL("/sign-in?error=confirm", origin));
}
