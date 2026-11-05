# DUO security model

DUO is a private space for exactly two people. The security goal is simple to state: **only the two people on a room's
allowlist can ever see, hear, read, download or control anything in that room**, and remote control happens only
with the sharer's explicit, revocable consent. This document lists every control, where it lives, and the test that
proves it. It also says honestly where the guarantees stop.

## Threat model

| Adversary                                                              | Can                         | Must not be able to                                                                      |
| ---------------------------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------- |
| Stranger on the internet                                               | Load public pages, sign up  | Find rooms, guess room or invite ids, read anything                                      |
| Signed-in non-member (incl. a third person holding a used invite link) | Use DUO for their own rooms | Join, read, list or download anything in a room they aren't on                           |
| The other room member                                                  | Everything in _their_ rooms | Control your tab without approval or after revoke, reach other tabs, read your clipboard |
| Malicious website (open in a tab)                                      | Run script in its own tab   | Talk to the DUO extension, inject into DUO, spoof control messages                       |
| LiveKit (media server)                                                 | Route encrypted media       | See or hear call content (when E2EE is on, the default)                                  |
| Network attacker                                                       | Observe traffic             | Read or alter it (TLS everywhere, HSTS preload, DTLS-SRTP for media)                     |

**Out of scope (stated plainly):** DUO's own backend (Supabase) can read the chat history, files and the per-room media
key it stores. End-to-end encryption here protects calls **against the media server**, not against DUO's operator.
Chat isn't end-to-end encrypted. A compromised device belonging to a member is out of scope.

## Controls

### Identity and access

- **Auth:** Supabase email + password; email confirmation on in production; minimum 10 characters; Supabase's per-IP
  limits on sign-in/sign-up. Sessions in HTTP-only cookies, refreshed by `src/proxy.ts`; server code uses `getClaims()`
  (signature-verified), never `getSession()`.
- **Rooms:** 128-bit random slugs; single-use 128-bit invite codes stored **only as SHA-256**, delivered in the URL
  _fragment_ (never sent to servers, logs or `Referer`), stripped from the address bar after reading.
- **Two-person allowlist** enforced by a database trigger with a row lock, so it holds under concurrent redemption.
- Non-members get the same "not found" for real and guessed rooms, so there's no existence oracle.
- _Tests:_ `tests/db/rls.test.ts` (allowlist, invite single-use, guessed codes, concurrency trigger),
  `tests/e2e/rooms.spec.ts` (third person locked out, guessed slug).

### Data (Postgres + Row Level Security)

- RLS on **every** table; Supabase's default grants revoked, then explicit **column-level** grants. Sensitive
  columns (invite hash) aren't selectable at all; spoofable columns (`sender_id`, `room_id` on reactions/Moments)
  are set by triggers, not trusted from clients.
- State machines in `SECURITY DEFINER` functions with fixed `search_path`: room creation, invites, control sessions.
- Rate limits enforced **inside Postgres** (room creation, invites, messages, reactions, control requests), so they
  can't be bypassed by calling the API directly; server routes add limits for media tokens, uploads, GIF search and
  account deletion.
- **Shared lists** follow the same model: members-only RLS on `lists` and `list_items`; an item's `room_id` comes from
  its list (not insertable by clients); `created_by`, `done_by` and timestamps are stamped by triggers; DB rate limit,
  50 lists per room and 500 items per list.
- _Tests:_ 70 PGlite tests run the real migrations with Supabase's role/grant model, and policies are mutation-checked
  (weakening one fails a test). `tests/e2e/chat.spec.ts` repeats the outsider checks against the live API.

### Realtime

- Database changes are broadcast only to the **private** topic `room:<id>`; authorization is RLS on `realtime.messages`
  (members only). Postgres-changes are deliberately not used (RLS can't filter DELETE events there).
- _Verified on the live project:_ an outsider's subscribe returns `Unauthorized`; a _public_ channel with the same
  topic receives nothing; spoofed public events don't reach members.

### Files

- Private bucket, 25 MB cap, MIME allow-list without SVG/HTML (audio/video only for recorded voice and video notes,
  enforced by `send_attachment_message`: a note's type must match its kind and it must carry a sane duration); storage RLS: members only, own room folder, exact path
  shape, uploader-only delete. Names sanitized (path, control and bidi characters stripped). Signed URLs expire in 5 min.
- Files are served from Supabase's domain, never DUO's origin, so even a mislabelled file can't script DUO.
- Room deletion and account deletion remove the stored files through the Storage API.
- _Tests:_ storage policies (PGlite), outsider can't sign/list/download (live API), deletion cleanup (live storage).

### Calls (LiveKit)

- Tokens minted server-side only after the session **and** allowlist check, bound to identity = user id and room = room
  UUID, 10-minute TTL, no admin/record grants, publish sources limited; LiveKit room capped at 2 participants.
- **End-to-end encryption (default on):** per-room 256-bit key, members-only (RLS + column grant), delivered with the
  token, used by LiveKit's E2EE worker in the browser; the key **rotates whenever the allowlist changes**. The call
  header shows "End-to-end encrypted" only when LiveKit reports both participants' media as encrypted.
- _Tests:_ token abuse (outsider 404, guessed 404, anonymous 401, cross-site 403, TTL, grants), A/V + screen share +
  Studio + remote control all verified with E2EE on; E2EE-off still works; key rotation (PGlite).

### Remote control

- Full details in [EXTENSION.md](EXTENSION.md). Summary: the extension has no host permissions; only exact DUO origins
  can connect; control binds to the single tab the owner picked; every message is schema-validated on the owner page
  and again in the extension, with session id, strictly increasing sequence numbers, expiry and a token bucket;
  browser shortcuts and paste are blocked; blocked URLs end control; the DUO page disconnecting ends control
  (fail-safe); emergency stop is a global shortcut; every session is written to an append-only audit log.
- The picture-in-picture window keeps Revoke visible while the owner is in the shared tab.
- _Tests:_ `tests/e2e/control.spec.ts` (real extension), `tests/unit/control.test.ts` (key filter, URL policy, schemas,
  mapping, rate limit).

### Web app

- **CSP:** per-request nonce with `strict-dynamic`; `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`,
  `form-action 'self'`; all WASM, workers, models and art self-hosted; only GIPHY media and the Supabase/LiveKit
  origins allowed remotely. The only frames allowed are YouTube's player (`frame-src` youtube-nocookie.com / youtube.com)
  for Watch Together; its API script is added by our own code, so `strict-dynamic` admits it without widening
  `script-src`. The player runs cross-origin and gets nothing from DUO: sync messages are LiveKit data packets,
  schema-validated (11-character video id, bounded numbers, 512-byte cap) before they touch the player. Plus HSTS (preload), `nosniff`, `X-Frame-Options: DENY`, COOP, a tight Permissions-Policy.
- **CSRF:** cookie-authenticated routes require `Sec-Fetch-Site: same-origin` (or a matching `Origin`).
- **XSS:** user content is always React text; links only for `http(s)` with `rel="noopener noreferrer nofollow ugc"`.
- **Secrets:** only in env vars (Vercel: stored as secrets); `server-only` modules fail the build if imported client-side;
  logs are structured and redact keys, tokens, codes, emails and bodies. Git history checked for leaked values before push.
- _Tests:_ CSP + nonce smoke test, XSS spec (markup in messages, links and display names), CI build without secrets.

## Reporting

Found something? Please email the repository owner privately instead of opening a public issue.
