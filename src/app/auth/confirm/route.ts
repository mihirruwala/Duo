import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { log } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/shared/invite";

const TYPES: readonly EmailOtpType[] = ["recovery", "email", "signup", "email_change", "magiclink", "invite"];

/**
 * Landing for links in DUO's emails (password reset, sign-up confirmation). Unlike /auth/callback
 * (PKCE), this verifies a one-time token hash, so the link works on any device or browser, not
 * only the one that asked for it. The Supabase email templates point here; see docs/EMAIL.md.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const fallback = type === "recovery" ? "/reset-password" : "/home";
  const next = safeNextPath(searchParams.get("next"), fallback);

  if (tokenHash && type && TYPES.includes(type)) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL(next, origin));
    log.warn("auth.confirm.verify_failed", { type, error_code: error.code });
  }
  const target = type === "recovery" ? "/forgot-password?error=link" : "/sign-in?error=link";
  return NextResponse.redirect(new URL(target, origin));
}
