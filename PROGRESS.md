# DUO: Progress

_Last updated: 2026-11-05_

## Milestone status

| Milestone              | Status                                                          |
| ---------------------- | --------------------------------------------------------------- |
| M1 Foundation          | **✅ Complete. Gate verified against hosted Supabase**          |
| M2 Core video          | ✅ Complete (gate verified on LiveKit Cloud)                    |
| M3 Chat                | ✅ Complete                                                     |
| M4 Remote control      | ✅ Complete                                                     |
| M5 DUO Studio          | ✅ Complete                                                     |
| M6 Hardening & release | ✅ Complete (ops items in ROADMAP #7 remain)                    |
| Round 2                | Pin, Watch Together, voice/video notes, shared lists. See below |

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

## Roadmap items 2–5 (2026-11-01)

| Item                  | What shipped                                                                                                                                                                                               | Verified by                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Knock & presence      | Home/room/in-call presence on the private room channel; Home cards with live status + Join; pre-call banner with Join now / Knock; chime + system notification when DUO isn't in front (opt-in, throttled) | `presence.spec.ts`: arrival, knock (toast + notification), call start, Home → room → join |
| Picture-in-picture    | Document PiP opens with the "share a tab they can control" click (or Pop out): their camera, control status + countdown, Revoke / Approve / Deny, mic + camera                                             | `control.spec.ts`: PiP opens automatically, approve and revoke from it                    |
| Profile settings      | `/settings`: name, colour, alert prefs, sign out, delete account (password re-auth, storage cleanup)                                                                                                       | `settings.spec.ts` against real storage                                                   |
| In-call fun           | Floating emoji reactions; photo booth (shared countdown, either can cancel) → chat + Moments                                                                                                               | `fun.spec.ts`                                                                             |
| M6: phones            | Call controls collapse into a More menu; chat launcher above the bar                                                                                                                                       | Screenshot at 390 px; controls within 52–337 px                                           |
| M6: errors            | `error.tsx` (retry), `global-error.tsx`, branded 404                                                                                                                                                       | n/a                                                                                       |
| M6: accessibility     | axe WCAG 2.1 AA, 0 serious/critical on 9 screens; keyboard-only join + mute; visible focus                                                                                                                 | `hardening.spec.ts`                                                                       |
| M6: XSS               | Markup in messages, links, display names inert                                                                                                                                                             | `hardening.spec.ts`                                                                       |
| M6: storage cleanup   | Room + account deletion remove files (Storage API)                                                                                                                                                         | `settings.spec.ts`                                                                        |
| M6: E2EE              | LiveKit E2EE on by default, per-room key (members-only, rotates on allowlist change), header badge, host toggle                                                                                            | `call.spec.ts` (badge both sides, A/V through E2EE; E2EE-off variant), 2 PGlite tests     |
| M6: security write-up | `docs/SECURITY.md`                                                                                                                                                                                         | n/a                                                                                       |

### Bugs found and fixed in this round

- The E2EE badge crashed the call before the other person joined (LiveKit's `useIsEncrypted` throws without a participant).
- Call controls overflowed off-screen on phones and the chat launcher covered them.
- axe: decorative logo SVGs announced as unnamed images; link/button names didn't include visible text; unnamed slider
  thumbs; `aria-label` on a role-less span.

## Round 2 (2026-11-05): pin, Watch Together, notes, shared lists

| Item                | What shipped                                                                                                                                                                                                                                                                                                                                                                             | Verified by                                                                                                                                                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pin / spotlight     | Pin button on every camera tile (and double-click): pinned person fills the stage, the other floats in a corner; tap a small tile to swap; during a screen share or Watch Together the pinned face is big and the content becomes a live thumbnail. Remembered per device. Layout is one grid whose children never remount, so videos and the YouTube player don't reload on a swap.     | `pin-watch.spec.ts` (pin, swap, persist across rejoin, pin over a live share, double-click)                                                                                                                                            |
| Watch Together      | Paste a YouTube link (watch, youtu.be, shorts, live, embed, `t=`); both play it locally in a youtube-nocookie frame. Sync over LiveKit data: whoever acts drives, heartbeats every 4 s, followers correct >1 s drift, seeks while paused detected, late joiners catch up, "Join playback" if autoplay is blocked. Either can change or end it; sharing a screen ends it. Headphones tip. | `pin-watch.spec.ts` against real YouTube (start, pause → other pauses within 1.5 s, other seeks to 2:00 → follows, thumbnail keeps playing, end for both); `watch.test.ts` (link parsing, message validation, driver/drift/echo rules) |
| Voice & video notes | Mic button in the composer (when empty); Video note in the attach menu with a live preview. MediaRecorder (webm/opus, mp4 on Safari), 5 min / 1 min limits, live level meter, waveform stored with the message, 1×/1.5×/2× playback, one note plays at a time. New message kinds `voice`/`video`; the RPC checks type ↔ kind, duration and waveform.                                     | `lists-notes.test.ts` (RPC rules, bucket/CHECK types), `notes-lists.test.ts` (waveform, format picking), `lists-notes.spec.ts` (record → other person plays it, discard, devices released)                                             |
| Shared lists        | "Lists" tab in the dock: templates, emoji, rename, delete (confirm), add / tick off / edit / delete items, "Added by" / "Done by", done section. Live via the room's private channel. YouTube links show **Watch** during a call.                                                                                                                                                        | `lists-notes.test.ts` (RLS, outsider, room_id from list, stamps, limits, cascade + broadcast), `lists-notes.spec.ts` (two people, live, reload)                                                                                        |

Migrations: `20261105000100_note_kinds.sql`, `20261105000200_voice_video_notes.sql`, `20261105000300_shared_lists.sql`.

### Bugs found and fixed in this round

- Double-clicking a small tile swapped it in and then immediately swapped back: the layout moves under the pointer, so
  the second click landed on whatever slid into place. Only the first click of a multi-click now counts.
- **Found on production, not locally:** a buffering stall made playback fall behind the clock, which the sync read as a
  seek; the stalled side took over as driver and the other person's pause, landing in the short "ignore the echo"
  window, was dropped. Now only a jump ahead or backwards counts as a seek, and the echo window ignores only the state
  we just applied. Unit tests for both.
- Gabe could get the "started Watch Together" toast twice (the start and a catch-up reply arrive together). One toast per session.
- YouTube sometimes shows one person a pre-roll ad. The film starts for them after it, and the other person is brought
  back to the same point. The E2E test now waits for YouTube's own "playing" state (`data-player-state`), not the ad's video.

### Watch mode and fullscreen (2026-11-05, from user testing)

- **Fullscreen fixed:** YouTube's own fullscreen button was blocked by our `Permissions-Policy` (now delegated to the
  YouTube frame only); DUO's fullscreen button only entered fullscreen, now it toggles (and follows Esc). In fullscreen
  (Watch Together or a share), your person's camera stays in a corner.
- **Watch mode** (Share → "Watch mode: share a show"): for shows on sites other than YouTube. Shares a Chrome tab tuned
  for motion: 1080p30, 6 Mbps, a 720p layer for weak links, framerate kept over resolution, stereo music-quality tab
  audio with no voice processing. DUO stays in front (CaptureController) so the sharer can pop out their person's face
  before switching to the show tab. Viewers get the show big (it takes over from a pin), a separate show-volume slider,
  and fullscreen with their person's face. Warns when no sound is shared (window picked instead of a tab). Offered from
  the Watch together dialog for non-YouTube links. Limits: DRM sites (Netflix, Disney+…) show black; quality follows
  the sharer's upload; the sharer's mic picks up speakers (headphones tip).
- _Verified:_ `pin-watch.spec.ts` (Watch mode with tab audio: pin gives way, label, video + separate sound track +
  decoded audio, fullscreen with partner, stop; Watch Together fullscreen both ways + frame fullscreen allowed).

Deployed 2026-11-05 to https://duo-virid-eta.vercel.app; the new specs, call and smoke suites pass against production.

## Ready for strangers, part 1 (2026-11-05)

- **Password reset:** "Forgot password?" on sign-in → `/forgot-password` (never reveals whether an account exists) →
  email link → `/auth/confirm` (one-time token hash, so the link works on any device) → `/reset-password` → home.
  Expired or reused links explain themselves; so do failed confirmation links on sign-in, which used to fail silently.
- **Change password** in Settings, after checking the current one.
- **Findable:** landing, sign-up and privacy are indexable; everything private stays `noindex` and is disallowed in
  `robots.txt`. `sitemap.xml`, canonical URL, and a 1200×630 preview card for links pasted into chat apps.
- Needs a domain and an email provider before reset emails reach real people: see `docs/EMAIL.md`.
- _Verified:_ `account.spec.ts` (reset link opened in a different browser context, single use, old password refused,
  change password, robots/sitemap/preview card, private pages noindex).

## Phone layout (2026-11-09)

On phones (under 640 px, so the iPhone app, the Android app and phone browsers) DUO now looks like an app instead of a
squeezed website. Desktop is unchanged.

- **Rooms:** a large title, rooms as list rows (person, room, live status, chevron), a + button, the invite box under the
  list, and a bottom tab bar (Rooms / Settings). Settings gets the same title and tab bar.
- **A room is its chat.** Native top bar: back chevron, your person and their status ("Here in the room", "In a call",
  "typing…"), and a call button (a green Join when they're already in a call). Chat / Media / Moments / Lists are a
  segmented control. Tapping your person opens the room's info as a bottom sheet.
- **Calls start from a sheet:** a portrait camera preview with mic, camera and switch-camera buttons, the mic check,
  Filters, and Join pinned to the bottom. No camera / mic / speaker lists. The camera only starts when the sheet opens.
- **In a call:** your person edge to edge, you in a corner under the header, header and controls floating over the video
  and fading after 5 s (tap to bring them back), no pin buttons or Pop out, Switch camera in More. Leaving goes back
  to the chat.
- **Messages:** actions (reply, react, copy, save, edit, delete) come up on a long-press with a small vibration, with
  bigger buttons, instead of on hover or tap.
- **No web feel:** no zoom when a field is focused (16 px inputs), no page rubber-banding, no tap flash, no text
  selection or callouts on controls, safe-area padding (viewport-fit=cover). The iOS app also turns off pinch-zoom and
  link previews. Browser wording ("address bar", "this browser", "Hover…") replaced where phones see it.

Verified by `phone.spec.ts` (390×844 touch): home rows and tab bar, the room as chat with no camera running, info sheet,
call sheet starting the camera, joining, full-width remote video, and Leave returning to the chat. Screens reviewed from
`phone-audit.spec.ts` (`DUO_PHONE_AUDIT=<dir>`).

## Separate dev database (2026-11-09)

Dev, local E2E and production no longer share one Supabase project. Production stays on "Duo"; `.env.local` points at
"Duo dev" (same region, same migrations, auto-confirmed sign-ups, localhost redirect URLs). Runs against the live site
(`E2E_BASE_URL=https://duoforyou.cv`) read production keys from the git-ignored `.env.live`. Realtime "Allow public
access" is off on both: every channel DUO uses is private. Details and commands: docs/ENVIRONMENTS.md.

## Sync a show (2026-11-09, DUO Control 1.1.0)

Watch Together for any site, each person on their own account. In a call: Watch together → **Sync a show**, then
DUO Control → **Sync this tab's video with DUO** on the show's tab; the other person does the same from the banner.

- The extension adds a small script to that one tab (the popup click's `activeTab` grant plus the new `scripting`
  permission, still no host permissions). It runs the same `WatchSync` engine as YouTube Watch Together against the
  page's biggest `<video>`, and follows it when the player swaps it.
- Only the tab's title (minus " | Netflix" etc.), its site, and "play / pause at t" go over the call.
- Whoever syncs second jumps to the first person's position. Either can lead after that.
- Netflix: seeks go through Netflix's own player API from a tiny in-page helper (seeking its `<video>` crashes it).
- Stops on Stop syncing, tab closed or reloaded, Leave, or DUO closed. Survives a call reconnect.
- DUO shows "Update DUO Control" to people on 1.0.x (they lack the `sync` feature flag in `hello.ok`).

Verified by `tab-sync.spec.ts`: two browsers each with the extension and a stand-in streaming page; the second person
catches up, pause / seek-while-paused / play follow both ways, and Stop syncing releases the other tab. Unit tests for the
message schemas and title cleanup. Not verified: real Netflix, Disney+ and Prime pages (needs accounts), so the
Netflix seek helper is untested.

## Hang-out mode (2026-11-08)

For leaving the call on for hours. The sofa button in the call bar (or More on phones) turns it on, per person:

- Your camera is captured and sent at 360p / 20 fps (one 180p layer under it), and their camera is received at no more
  than the medium layer. Watch Together and shared tabs keep full quality.
- Effects are paused, not forgotten: they come back when you turn it off.
- The screen is kept awake (Screen Wake Lock), so a phone doesn't lock and drop the call.
- **Sleep:** black screen with a dim clock. Your camera goes off and their video stops downloading; sound keeps going both
  ways. Any tap or key wakes it, and the camera comes back if it was on.
- The other person sees "Hana is hanging out" / "Hana is asleep" in the header (data message, re-sent when they rejoin).
- The mode survives a reconnect or reload of the same tab (sessionStorage per room).

Verified by `hangout.spec.ts`: capture drops from 720p to 360p and back, the chip on the other side, effects disabled,
sleep turns the camera off and stops their video while audio flows both ways, wake, and a reload keeps the mode.
Received resolution can't be asserted in E2E (adaptive stream already sizes it to the tile), so that cap is untested.

## Chrome Web Store (2026-11-05)

- `npm run ext:build:store` builds an upload-ready zip: production origin only, no `key` (the store assigns the ID).
- Public privacy policy at `/privacy`, linked from the landing page, covering both the extension and the app.
- Listing text, permission justifications, data-use answers, reviewer steps: `docs/CHROME_WEB_STORE.md`. Images
  (real screenshots from the remote-control E2E, framed at 1280×800, a 440×280 tile, a padded icon) come from
  `extension/store-assets/render.mjs`.
- Once `NEXT_PUBLIC_DUO_EXTENSION_ID` is set to the store's ID, the install dialog shows "Add to Chrome" instead of
  developer-mode steps.
- Two intermittent E2E failures turned out to be test races, now fixed: the keyboard test pressed ⌘D while the call was
  still joining, and the XSS test counted links before the last message arrived.

## Audit phase 2 (2026-11-05): chat beside the call, ask to pause

- **Chat no longer covers your person.** During a call the chat opens from a Chat button in the control bar (with
  the unread count) instead of a floating pill over the video. On wide screens (1024 px+) it docks as a full-height
  panel on the right and the call moves over to make room; on tablets it floats but stops above the controls; on
  phones it takes the screen and closes back to the call. Outside a call nothing changed. The open state is shared
  through `src/features/chat/dock-store.ts`.
- **Ask to pause (Watch mode).** The viewer can't pause the sharer's tab, so the show header has "Ask to pause"
  (8 s cooldown, shows "Asked"). The sharer is usually on the show's tab, so they get a chime, a system notification
  when DUO isn't in front, a banner in the pop-out window, and a note on DUO's own tab. Sent as a validated LiveKit
  data message (`ask-pause` in `src/shared/fun.ts`).
- Watch-mode shares are labelled as shows for the sharer too ("You're sharing a show").
- _Verified:_ `call-chat.spec.ts` (unread count in the bar, docked panel never overlaps the video or controls,
  full-height, phone opens full screen and closes, desktop gets its width back); `pin-watch.spec.ts` (ask to pause
  reaches the sharer); screenshots at 1440, 1280, 900 and 390 px.

## Audit phase 1 (2026-11-05)

Found during a full audit (code, live site, screenshots at desktop and phone sizes).

| ID  | Problem                                                                                                                                                                                                            | Fix                                                                                                                                                        | Test                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| V1b | **First call in a new room had no video or sound** if the host was already in the call when the guest accepted the invite. Accepting replaces the room's media key, and the host kept encrypting with the old one. | When someone new shows up on the room channel, the room page refreshes its data and a call in progress rejoins with a fresh token (`room-experience.tsx`). | `first-call.spec.ts` (failed on production before the fix) |
| V1  | A host waiting in a new room never saw their person arrive (members list, name, presence) until reloading.                                                                                                         | Same refresh.                                                                                                                                              | `first-call.spec.ts`                                       |
| V3  | On phones the call was two small stacked tiles with yourself on top.                                                                                                                                               | Narrow screens default to your person big and you floating top-left (`call-stage.tsx`).                                                                    | `first-call.spec.ts` (phone viewport)                      |
| V4  | The Share button showed on browsers that can't share a screen (Android, iOS).                                                                                                                                      | Hidden unless `getDisplayMedia` exists.                                                                                                                    | `first-call.spec.ts`                                       |
| V5  | The headphones tip covered YouTube's controls.                                                                                                                                                                     | Moved to a strip under the Watch Together header.                                                                                                          | `pin-watch.spec.ts`                                        |
| V6  | Landing said "encrypted in transit" and didn't mention watching together, voice notes or lists.                                                                                                                    | Accurate privacy line, a fourth pillar.                                                                                                                    | `smoke.spec.ts`, axe                                       |
| V7  | Chat empty state was cramped against the top on phones.                                                                                                                                                            | Spacing.                                                                                                                                                   | screenshot                                                 |

Also: patch updates (Next 16.4.5, React 19.3.1, supabase-js 2.119.0, lucide-react 1.69.0). Production
dependencies have no known vulnerabilities; the dev-only tools (shadcn CLI, ESLint) have moderate advisories whose
fixes are breaking downgrades, so they stay as they are.

Seen once and passed on rerun: the XSS spec (one link missing from the list) and Watch Together. Not reproduced.

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

- No Docker on the dev machine, so local Supabase is unavailable. Dev and E2E use a separate hosted project, "Duo dev"
  (docs/ENVIRONMENTS.md).
- Dev uses **LiveKit Cloud**. `npm run livekit` (native server via Homebrew's verified bottle) exists but was not run here;
  the tool sandbox blocked executing a downloaded binary.
- Calls are end-to-end encrypted against the media server (LiveKit) by default. The key lives in Supabase, so this doesn't
  protect against DUO's own backend; chat isn't end-to-end encrypted. See docs/SECURITY.md.
- `cacheComponents` disabled on purpose (nonce CSP). `style-src 'unsafe-inline'` kept for Radix/LiveKit inline styles.
- Room and account deletion now remove stored files. Files orphaned _before_ this fix (from earlier deletions) are
  still in the bucket, private and unreachable.
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
