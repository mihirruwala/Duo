# DUO: Progress

_Last updated: 2026-10-31_

## Milestone status

| Milestone              | Status                                                 |
| ---------------------- | ------------------------------------------------------ |
| M1 Foundation          | **✅ Complete. Gate verified against hosted Supabase** |
| M2 Core video          | Not started                                            |
| M3 Chat                | Not started                                            |
| M4 Remote control      | Not started                                            |
| M5 DUO Studio          | Not started                                            |
| M6 Hardening & release | Not started                                            |

## M1: completed

- Next.js 16.4 + React 19.3 + TS strict (`noUncheckedIndexedAccess`) + Tailwind 4 + shadcn/ui (Radix). All deps pinned.
- DUO design system: tokens in `globals.css` (aubergine surfaces, coral/violet accents, brand gradient), Bricolage
  Grotesque + Figtree, restyled Button/Input/Card, logo mark + wordmark, avatar, "Coming soon" badge.
- Landing page, sign-in / sign-up (email + password), auth callback (PKCE confirm), signed-in home with room list,
  create-room dialog, invite sharing, `/join` redemption, room page with membership + leave/delete.
- Database migration `20261031000100_core_schema.sql`: profiles, rooms, room_members (allowlist), messages,
  message_reactions, message_receipts, attachments, moments, control_sessions, rate_limits. RLS on every table,
  column-level grants, SECURITY DEFINER functions (`create_room`, `rotate_invite`, `redeem_invite`,
  `control_request`, `control_transition`), DB-enforced rate limits, two-member trigger.
- Security: per-request nonce CSP via `src/proxy.ts`, static security headers, open-redirect-safe `next` handling,
  invite code in URL fragment (never reaches server logs), redacting structured logger, server-only secret modules.
- Tooling: `typecheck`, `lint`, `format`, `test`, `test:e2e`, `check` scripts; `.env.example` documented.

## Verified

| What                                                            | How                                                                                                                    | Result                                            |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Schema + RLS                                                    | `npm test` → 45 RLS tests run the real migration in PGlite with Supabase role/grant emulation                          | ✅ 45/45                                          |
| RLS tests can fail                                              | Temporarily changed `messages_select` to `using (true)`                                                                | ✅ the outsider test failed as expected; reverted |
| Invite/slug parsing, safe redirects, error mapping, CSP builder | Vitest unit tests                                                                                                      | ✅ 14/14                                          |
| Typecheck, lint, formatting                                     | `npm run check`, `prettier --check`                                                                                    | ✅ clean                                          |
| Production build                                                | `npm run build`                                                                                                        | ✅ all routes dynamic (needed for nonce)          |
| CSP actually enforced                                           | Playwright in Chrome: landing hydrates under the CSP with zero console errors; header nonce matches all 16 script tags | ✅                                                |
| Anonymous redirects                                             | Playwright: `/home`, `/r/*` → `/sign-in?next=…`                                                                        | ✅                                                |
| Responsive landing                                              | Screenshots at 1440 px and 390 px, no horizontal overflow                                                              | ✅                                                |

## M1 gate (hosted Supabase)

| What                                                                                                                                        | How                                                                                                         | Result             |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------ |
| Migration applied                                                                                                                           | Anonymous REST probe of profiles/rooms/messages → `42501 permission denied` (tables exist, anon locked out) | ✅                 |
| Sign up → create room → second session joins via invite → third user rejected (dead invite + "Room not found" on direct URL + guessed slug) | `tests/e2e/rooms.spec.ts`, two isolated Chrome contexts, production build                                   | ✅ 4/4 e2e passing |

## M2: completed

- `POST /api/rooms/[slug]/token`: verified session, allowlist check (non-members get the same 404 as a
  nonexistent room), same-origin check (CSRF), DB-backed rate limit (30 / 10 min / user), identity = user id,
  room = room UUID, 10-minute TTL, no admin/record grants, publish sources limited to camera/mic/screen(+audio).
  The LiveKit room is also created with `maxParticipants: 2` as defence in depth.
- Pre-call studio: mirrored camera preview, live mic meter (Web Audio), camera/mic/speaker selection with a test
  chime, saved device choices, clear permission/busy/missing-device errors. Preview tracks are always stopped on leave.
- Meeting room: two-up layout → screen-share stage (LIVE banner, full screen, camera thumbnails), mute/camera/share/
  leave controls, ⌘/Ctrl+D and ⌘/Ctrl+E shortcuts, live device menus, speaking ring, connection quality,
  reconnecting banner, autoplay-blocked "Turn on sound", partner-left / waiting / duplicate-tab / failed states.
- Screen share: tab/window/screen with tab audio, stops from DUO or Chrome's native bar; one sharer at a time.
- `docs/MANUAL_TESTS.md`: real-hardware checklist.

## M2 gate (LiveKit Cloud)

| What                            | How                                                                                                          | Result           |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------- |
| Both see each other             | Remote `<video>` decoding frames (videoWidth > 0, playing) on both sides                                     | ✅               |
| Both hear each other            | Web Audio analyser on the decoded remote `<audio>` stream: peak > 0.01 on both sides                         | ✅               |
| Mute reflected remotely         | Muted-mic icon appears/disappears on the other tile                                                          | ✅               |
| Live device switch              | Switch mic mid-call from the device menu; the remote side still receives audio                               | ✅               |
| Reconnection                    | Guest goes offline → "Reconnecting…" → back online → "Connected", video still playing                        | ✅               |
| Screen share live               | Viewer sees "Hana is sharing their screen" and the share video decoding                                      | ✅               |
| Stop: native + in-app           | Ending the capture track (native stop) and the DUO button both clear the share on both sides                 | ✅               |
| Clean leave                     | "You left the call", host sees "Gabe left the call", 0 live media tracks left on the guest page              | ✅               |
| Third / uninvited user rejected | Token API: outsider 404, guessed room 404, anonymous 401, cross-site 403; token TTL ≤ 600 s, no admin/record | ✅               |
| Stability                       | Full e2e suite (6 specs) run twice back to back                                                              | ✅ 6/6 both runs |

Test doubles, stated plainly: Chrome's fake camera/mic, and a canvas stream in place of `getDisplayMedia` (the real OS
picker can't be clicked in automation). Real devices and real screen capture are in `docs/MANUAL_TESTS.md`. **Not yet run by a human.**

## Known issues / decisions

- No Docker on the dev machine, so local Supabase is unavailable. Using hosted Supabase for dev (see ARCHITECTURE §6).
- Dev uses **LiveKit Cloud**. `npm run livekit` (native server via Homebrew's verified bottle) exists but was not run here;
  the tool sandbox blocked executing a downloaded binary.
- Transport is DTLS-SRTP encrypted, but LiveKit's SFU can see media. This is **not end-to-end encryption**. E2EE is an M6 stretch goal.
- `cacheComponents` disabled on purpose (nonce CSP). `style-src 'unsafe-inline'` kept for Radix/LiveKit inline styles.
- Deleting a room cascades all rows, but storage objects get cleaned up only once Storage lands in M3.
- `supabase/seed.sql` not written: seeding needs local Supabase (Docker). The e2e suite creates its own users.
- Database types (`src/shared/database.ts`) are hand-written until a project is linked (`npm run db:types`).

## Next steps

1. Run the M2 section of `docs/MANUAL_TESTS.md` on two real machines.
2. M3: chat (Realtime, replies, reactions, edits, receipts, images, GIFs, stickers, files, gallery, Moments). Needs a GIPHY API key.
