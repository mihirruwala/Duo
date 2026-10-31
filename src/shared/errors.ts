/**
 * Maps machine-readable errors raised by our SQL functions (see migrations) and
 * Supabase Auth to short, human messages. Unknown errors get a generic message:
 * raw database text is never shown to users.
 */
const MESSAGES: Record<string, string> = {
  rate_limited: "Whoa, slow down a little. Try again in a moment.",
  invalid_invite: "That invite isn't valid anymore. Ask for a fresh link.",
  room_full: "This room already has its two people.",
  room_not_found: "This room doesn't exist, or you don't have access to it.",
  not_authenticated: "Please sign in first.",
  no_peer: "Your person hasn't joined this room yet.",
  invalid_transition: "That action isn't possible right now.",
  session_not_found: "That control session has ended.",
  message_deleted: "That message was deleted.",
  not_editable: "Only text messages can be edited.",
  invalid_reply: "You can only reply to messages in this room.",
};

const AUTH_MESSAGES: Record<string, string> = {
  invalid_credentials: "Wrong email or password.",
  email_not_confirmed: "Please confirm your email first. Check your inbox.",
  user_already_exists: "An account with that email already exists. Try signing in.",
  weak_password: "Pick a stronger password (at least 10 characters).",
  over_request_rate_limit: "Too many attempts. Wait a few minutes and try again.",
  over_email_send_rate_limit: "Too many emails sent. Wait a bit and try again.",
};

export type ErrorLike = { message?: string; code?: string } | null | undefined;

export function friendlyError(error: ErrorLike, fallback = "Something went wrong. Please try again."): string {
  if (!error) return fallback;
  if (error.code && AUTH_MESSAGES[error.code]) return AUTH_MESSAGES[error.code]!;
  const key = (error.message ?? "").trim();
  return MESSAGES[key] ?? fallback;
}

export function errorKey(error: ErrorLike): string | undefined {
  const key = (error?.message ?? "").trim();
  return key in MESSAGES ? key : undefined;
}
