# DUO: Progress

_Last updated: 2026-10-31_

## Milestone status

| Milestone | Status |
|---|---|
| M1 Foundation | **✅ Complete. Gate verified against hosted Supabase** |
| M2 Core video | Not started |
| M3 Chat | Not started |
| M4 Remote control | Not started |
| M5 DUO Studio | Not started |
| M6 Hardening & release | Not started |

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

| What | How | Result |
|---|---|---|
| Schema + RLS | `npm test` → 45 RLS tests run the real migration in PGlite with Supabase role/grant emulation | ✅ 45/45 |
| RLS tests can fail | Temporarily changed `messages_select` to `using (true)` | ✅ the outsider test failed as expected; reverted |
| Invite/slug parsing, safe redirects, error mapping, CSP builder | Vitest unit tests | ✅ 14/14 |
| Typecheck, lint, formatting | `npm run check`, `prettier --check` | ✅ clean |
| Production build | `npm run build` | ✅ all routes dynamic (needed for nonce) |
| CSP actually enforced | Playwright in Chrome: landing hydrates under the CSP with zero console errors; header nonce matches all 16 script tags | ✅ |
| Anonymous redirects | Playwright: `/home`, `/r/*` → `/sign-in?next=…` | ✅ |
| Responsive landing | Screenshots at 1440 px and 390 px, no horizontal overflow | ✅ |

## M1 gate (hosted Supabase)

| What | How | Result |
|---|---|---|
| Migration applied | Anonymous REST probe of profiles/rooms/messages → `42501 permission denied` (tables exist, anon locked out) | ✅ |
| Sign up → create room → second session joins via invite → third user rejected (dead invite + "Room not found" on direct URL + guessed slug) | `tests/e2e/rooms.spec.ts`, two isolated Chrome contexts, production build | ✅ 4/4 e2e passing |

## Known issues / decisions

- No Docker on the dev machine, so local Supabase is unavailable. Using hosted Supabase for dev (see ARCHITECTURE §6).
- `cacheComponents` disabled on purpose (nonce CSP). `style-src 'unsafe-inline'` kept for Radix/LiveKit inline styles.
- Deleting a room cascades all rows, but storage objects get cleaned up only once Storage lands in M3.
- `supabase/seed.sql` not written: seeding needs local Supabase (Docker). The e2e suite creates its own users.
- Database types (`src/shared/database.ts`) are hand-written until a project is linked (`npm run db:types`).

## Next steps

1. M2: download native `livekit-server` (no Docker), token route with allowlist check, pre-call studio, call UI.
