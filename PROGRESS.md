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

## M3: completed

- Migrations `…0200_chat_realtime_storage`, `…0300_chat_receipts_rpc` (applied to hosted Supabase):
  - **Realtime via broadcast-from-database** into private topics `room:<id>`. Triggers on messages, reactions, receipts,
    attachments, Moments and control sessions. Authorization = RLS on `realtime.messages` (members only). Chosen over
    postgres-changes because Realtime can't apply RLS to DELETE events there.
  - Private `attachments` bucket (25 MB, MIME allow-list, no SVG/HTML), storage RLS: members only, own room folder,
    strict path shape, uploader-only delete.
  - `send_attachment_message` (atomic message + attachment, verifies the object exists and is yours),
    `mark_receipts` (monotonic watermarks), tombstoning a message removes its attachment rows + Moments.
- `POST /api/rooms/[slug]/uploads` (signed upload URL with user session, sanitized name, rate-limited);
  `GET /api/gifs` (GIPHY proxy, key server-only, auth + rate limit, URLs validated against `media*.giphy.com`).
- Chat UI: floating dock (resizable from the top-left handle or arrow keys, collapsible, remembers size/state, unread
  badge, full-screen on phones), works in pre-call and in-call; tabs Chat / Media / Moments.
  Messages: optimistic send with retry, reply with quote + jump (loads older history if needed), reactions
  (quick + more, counts, who reacted), copy, edit (edited marker), delete (tombstone), typing indicator, presence,
  Sent/Delivered/Read, day separators and grouping, safe link rendering, infinite scroll upwards, reconnect resync.
  Media: image upload with progress + inline display, full-screen viewer (Esc, ←/→, zoom + − 0, wheel, double-click),
  files with signed download links, 12 original stickers, GIF search, paste and drag-and-drop upload.
  Media gallery (all photos/GIFs/files in the room) and shared Moments.

## M3 gate

| What                         | How                                                                                                                                                      | Result                    |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Messages arrive instantly    | Two sessions; measured send → visible on the other side                                                                                                  | ✅ 313–454 ms across runs |
| Replies link to the original | Quote shows on both sides; clicking jumps + highlights                                                                                                   | ✅                        |
| Reactions sync               | ❤️ from Gabe → Hana sees 1; Hana adds hers → Gabe sees 2                                                                                                 | ✅                        |
| Edit / delete                | "edited" marker and tombstone on the other side                                                                                                          | ✅                        |
| Typing + receipts            | "Hana is typing…" on Gabe's side; Hana's message shows "Read"                                                                                            | ✅                        |
| Images                       | Upload → decoded inline on the other side → viewer opens, zooms, closes with Esc                                                                         | ✅                        |
| Files                        | PDF upload, `../../plans/trip.pdf` sanitized to `trip.pdf`, signed download works                                                                        | ✅                        |
| Stickers                     | Sent and rendered on the other side                                                                                                                      | ✅                        |
| GIFs                         | Search proxy + picker built; **not run end-to-end: no GIPHY key yet**                                                                                    | ⏸                         |
| Moments + gallery            | Gabe saves photo → in Hana's Moments; gallery lists photo + file                                                                                         | ✅                        |
| Unread badge                 | Collapsed dock shows 1 after a new message                                                                                                               | ✅                        |
| Persistence                  | Reload: history, reply, reactions, edit marker, tombstone, sticker, image all restored                                                                   | ✅                        |
| Ordering                     | 6 rapid messages right after opening chat: same order on both sides and after reload                                                                     | ✅                        |
| Outsider can't read          | Real Supabase API as an outsider: messages/attachments/Moments/reactions/receipts = [], can't sign/list/download files, can't post, channel join refused | ✅                        |
| Public-channel leak probe    | Outsider on a _public_ channel with the same topic receives 0 broadcasts; spoofed public events don't reach members                                      | ✅                        |
| DB policies                  | 21 PGlite tests (realtime authorization, storage, broadcasts, RPCs); one policy mutation-checked                                                         | ✅                        |
| Suites                       | Unit+DB 88/88; e2e 9/9 on the production build and 9/9 on `next dev`                                                                                     | ✅                        |

## M4: completed

- **Extension** (`extension/`, MV3, built with `npm run ext:build`): permissions `debugger`, `tabCapture`, `activeTab`,
  `notifications`. No host permissions, no `tabs`. Exact-origin `externally_connectable`, stable ID, global emergency
  stop **⌘⇧9 / Ctrl+Shift+9**. Popup: share this tab / stop sharing / revoke. Input via CDP into the one shared tab ID.
  An isolated-world overlay on that tab (frame, "Name is controlling" banner with the shortcut, their cursor), a red CTRL
  badge, a notification for approvals. Ends on: revoke, emergency stop, expiry, tab closed, blocked navigation,
  debugging bar closed, DUO page gone, share stopped.
- **Protocol** (`src/shared/control.ts`, 47 unit tests): Zod schemas for peer and extension messages, letterbox-aware
  coordinate mapping, virtual key codes, key-combo allowlist (paste + browser shortcuts blocked, DevTools combos too),
  URL policy, token-bucket rate limit.
- **DUO page:** Share menu (view-only vs. controllable tab), tab-pick and install dialogs, approval dialog (explains the
  debugging bar), red "Remote control active" banner with countdown + Revoke + shortcut, controller bar
  (request/waiting/in control/hand back), input-capture surface with "You" cursor, audit-log writes for every transition.
- Docs: `docs/EXTENSION.md` (install, permissions rationale, debugger vs content-script evaluation, security model).

## M4 gate

All of this runs in one E2E test. The owner uses Playwright's Chromium with the real extension (E2E build); the controller
is a separate Chrome session; input travels controller → LiveKit Cloud → owner page → extension → CDP → a real tab.

| What                                                                                                           | Result        |
| -------------------------------------------------------------------------------------------------------------- | ------------- |
| Nothing reaches the tab before approval (click sent while "waiting")                                           | ✅ 0 clicks   |
| Approval dialog → banner on owner, "You're controlling" on controller, overlay injected on the tab             | ✅            |
| Click (event `isTrusted: true`), double-click, right-click                                                     | ✅            |
| Typing into a field, ⌘/Ctrl+A then retype                                                                      | ✅            |
| Paste refused (owner's clipboard stays private)                                                                | ✅            |
| Scroll inside a scroll container; drag (≥ 200 px)                                                              | ✅            |
| Another open tab receives nothing                                                                              | ✅            |
| Click a link → page 2 → control and overlay continue                                                           | ✅            |
| Revoke → controller UI updates (measured), further input ignored, overlay removed                              | ✅ 131–238 ms |
| Emergency-stop handler ends control (command handler invoked via E2E hook)                                     | ✅            |
| Shared tab navigates to DUO (blocked) → control ends                                                           | ✅            |
| Non-DUO pages have no `chrome.runtime` (can't reach the extension)                                             | ✅            |
| Binding the DUO tab itself is refused by the extension                                                         | ✅            |
| Audit log rows: `revoked:owner_revoked`, `revoked:emergency_stop`, `ended:blocked_url`, all with approval time | ✅            |

**Test doubles, stated plainly:** (1) choosing the tab in the real popup needs a human click (Chrome's `activeTab` grant),
so the E2E build binds the tab via a test hook and answers `getUserMedia({chromeMediaSource:"tab"})` with a canvas. (2)
Pressing a _global_ shortcut can't be automated, so the test invokes the same command handler. Both hooks exist only in
`extension/dist-e2e` (verified absent from `extension/dist`). The real popup flow and the real shortcut are in `docs/MANUAL_TESTS.md`.

## M5: completed

- **Pipeline:** camera → `MediaStreamTrackProcessor` → transferable stream → **classic Web Worker** → MediaPipe
  ImageSegmenter + FaceLandmarker (GPU delegate, CPU fallback; loaded lazily, only for looks that need them) → WebGL2
  compositor on an OffscreenCanvas (separable blur at ¼ res, feathered person mask with temporal smoothing,
  cover-fit backgrounds, effect shaders) → 2D prop pass → `VideoFrame` → `MediaStreamTrackGenerator` → LiveKit
  `setProcessor()` (replaceTrack, no renegotiation). Idle = processor removed, zero cost.
- **Shipped looks:** backgrounds: blur (adjustable), Cozy room, Spaceship, Anime sky, Tropical escape, your own image.
  Live effects: Black & white, Vintage film, VHS, Retro webcam, Pixelate, Night vision, Invert. Face filters: Puppy,
  Kitty, Cool shades, Big eyes, Crown, Floating hearts, Confetti. All art is original (SVG).
- **Studio UI:** categories Animals / Funny / Cartoon / Backgrounds / Live effects, quick toggles (blur + strength,
  VHS, face tracking), live preview, custom upload, "Turn everything off". Available in pre-call and in-call (Effects button).
- **Self-hosted assets:** MediaPipe WASM copied at build (`scripts/prepare-studio.mjs`), models vendored in
  `public/models` (Apache-2.0), CSP unchanged.
- **Adaptive quality:** 3 levels (segmentation resolution / landmark cadence), warm-up frames ignored, last resort turns
  heavy features off with a toast. Dev/`?debug=1` read-out: fps, ms/frame, per-model time and delegate.

## M5 gate

| What                                  | How (sampled from the _remote_ participant's decoded video)                  | Result             |
| ------------------------------------- | ---------------------------------------------------------------------------- | ------------------ |
| Effect visible to the other person    | Black & white: remote saturation                                             | ✅ 0.000           |
| Switch mid-call without renegotiation | Invert: remote green camera becomes magenta                                  | ✅                 |
| Image background                      | Tropical: remote top quarter turns sky-blue                                  | ✅                 |
| Blur                                  | Remote edge energy with vs without blur                                      | ✅ 0.0045 → 0.0025 |
| Everything off                        | Processor removed; remote video back to the raw camera                       | ✅                 |
| Face tracking runs                    | Landmarker on GPU, per-frame time reported                                   | ✅                 |
| Prop geometry                         | Unit tests: anchors, scale ∝ eye distance, roll, smoothing, particle systems | ✅ 15 tests        |

**Performance** (Apple M4, Chrome 156, 1280×720 frames, after warm-up; the 20 fps is Chrome's fake-camera rate):

| Look            | ms / frame | Model time           | Delegate |
| --------------- | ---------- | -------------------- | -------- |
| Background blur | 9.6–9.7    | segmentation 8.9–9.3 | GPU      |
| Face filter     | 7.6–9.0    | landmarks 7.1–9.2    | GPU      |

Budget for 30 fps is 33 ms: about 3× headroom on this machine.

**Not automatable, stated plainly:** Chrome's fake camera contains no face, so props being _drawn on a real face_ is
verified by unit tests (geometry) plus the manual checklist, not by E2E.

## Deployment (2026-10-31)

- Live at **https://duo-virid-eta.vercel.app** (Vercel, functions in `dub1`; Supabase `eu-west-1`; LiveKit Cloud).
- Pre-flight: production dependency audit 0 vulnerabilities (moved the build-only `shadcn` CLI to devDependencies).
- Verified on the live site:
  - HTTPS redirect, HSTS (preload), CSP with per-request nonce (26/26 scripts), `frame-ancestors 'none'`, `upgrade-insecure-requests`
  - anonymous visitors → `/sign-in`; token and GIF APIs → 401
  - **full E2E suite 13/13 against production**: video/audio/screen share, chat incl. GIFs, outsider isolation,
    remote control with the extension, rooms/invites, sign-up form
- Found and fixed while preparing: sign-up/sign-in forms erased typed values after a validation error (React 19
  `<form action>` reset). Regression test added.
- Tests now create confirmed users via the admin API and delete them afterwards, so they work with "Confirm email" on.
- Pending on the Supabase dashboard (not automatable from here): production Site/Redirect URLs, Confirm email on,
  custom SMTP. Leftover test accounts from earlier runs (≈308 `duo-e2e-*@example.com`) still need deleting; the bulk
  delete was blocked by the tool sandbox.
- Recommended next: a separate Supabase project for production (dev and E2E currently share it), and Realtime
  "Allow public access" off.

## Bugs found in user testing

- **2026-10-31: "Disconnected" on join under `npm run dev`.** The `Room` was created once and reused across React StrictMode's
  dev double-mount, so the second `connect()` ran on a Room disconnected mid-connect. Tests only ran the production build, so they
  missed it. Fix: a fresh `Room` per effect run, exposed to the UI only after it connects. Added `npm run test:e2e:dev` so dev mode stays covered.

### Bugs found while building M5 (fixed)

- Quality governor reacted to start-up (shader compile, model load), lowering quality and toasting on plain B&W. It now
  ignores warm-up frames after start, model loads and config changes.
- MediaPipe can't run in a module worker ("ModuleFactory not set"). The worker is bundled as a classic script.
- Worker typings leaked into the app (`lib: webworker`); the worker now has its own tsconfig.

### Bugs found while building M4 (fixed)

- **DevTools shortcuts slipped through the key filter** (⌘⌥I / Ctrl+Shift+I: "i" was allowed for italics). Alt with
  ⌘/Ctrl is now always blocked, and Shift only with undo/redo/selection keys. Unit tests added.
- Adding the Share menu broke the M2 call test's one-click share; the test caught it and now uses the menu.
- Toasts covered the control banner; the emergency-shortcut label could be stale before the extension reported the real one.

### Bugs found while building M3 (fixed, with regression tests)

- Initial history load could **drop messages** sent while it was in flight (load replaced state). Now merges. Unit + e2e tests.
- Quick successive messages could **swap order** (parallel inserts race). Sends are now serialized per tab. E2E test.
- Chat didn't stay pinned to the bottom when images finished loading. ResizeObserver keeps it pinned.
- Dock briefly flashed closed on reload before restoring its open state. Now renders nothing until restored.
- E2E hygiene: contexts from earlier tests stayed open (some in live calls). Now auto-closed after each test.

## Known issues / decisions

- No Docker on the dev machine, so local Supabase is unavailable. Using hosted Supabase for dev (see ARCHITECTURE §6).
- Dev uses **LiveKit Cloud**. `npm run livekit` (native server via Homebrew's verified bottle) exists but was not run here;
  the tool sandbox blocked executing a downloaded binary.
- Transport is DTLS-SRTP encrypted, but LiveKit's SFU can see media. This is **not end-to-end encryption**. E2EE is an M6 stretch goal.
- `cacheComponents` disabled on purpose (nonce CSP). `style-src 'unsafe-inline'` kept for Radix/LiveKit inline styles.
- Deleting a room cascades all rows, but its **storage objects are not yet removed** (they stay private, since the
  folder's room no longer exists so no one passes RLS). Cleanup job is planned for M6.
- Upload type checks use the declared MIME type (bucket + route + client), not content sniffing. Files are served from
  the Supabase storage domain, never DUO's origin, and SVG/HTML are refused, so this can't become XSS on DUO.
- Several files sent at once are placed in the order their uploads finish. Text/GIF/sticker order is strict.
- Media gallery shows the latest 200 items.
- Remote control: expiry isn't exercised in E2E (shortest room limit is 60 s); it's enforced in three places (DB `expires_at`, owner
  page timer, extension timer). Non-Latin IME composition isn't forwarded (only direct key input).
- The extension's minified `background.js` is ~458 KB, mostly Zod; fine unpacked, worth trimming (e.g. `zod/mini`) before a Web Store release.
- Recommended: Supabase Dashboard → Realtime → Settings → disable "Allow public access" (defence in depth; the probe
  above shows public channels already receive nothing).
- `supabase/seed.sql` not written: seeding needs local Supabase (Docker). The e2e suite creates its own users.
- Database types (`src/shared/database.ts`) are hand-written until a project is linked (`npm run db:types`).

## Next steps

1. Run the M2–M4 sections of `docs/MANUAL_TESTS.md` on two real machines (especially the real popup flow and ⌘⇧9).
2. M5: DUO Studio (MediaPipe face filters, background blur/replace, live effects, perf measurements).
