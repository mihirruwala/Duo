# DUO Architecture

Status: living document. Sections marked _(planned)_ describe milestones not yet built.

## 1. Folder structure

```
duo/
├── src/
│   ├── app/                     Next.js App Router (routes only, thin)
│   │   ├── page.tsx             Landing
│   │   ├── sign-in/ sign-up/    Auth screens
│   │   ├── home/                Signed-in hub: your rooms, create room, join by code
│   │   ├── join/[code]/         Invite redemption
│   │   ├── r/[slug]/            Room (lobby → pre-call studio → meeting)
│   │   └── api/                 Route handlers (POST-only for mutations)
│   ├── components/ui/           shadcn primitives restyled with DUO tokens
│   ├── components/brand/        Logo, wordmark, decorative pieces
│   ├── features/<feature>/      Feature modules: auth, rooms, call, chat, control, studio
│   │   ├── components/          Feature UI
│   │   ├── server/              Server-only logic (never imported by client code)
│   │   └── *.ts                 Hooks, client logic
│   ├── lib/                     Cross-cutting: env, supabase clients, http, log, rate-limit
│   ├── shared/                  Types + Zod schemas shared by client, server AND extension
│   └── proxy.ts                 Session refresh + per-request CSP nonce
├── extension/                   Chrome MV3 extension (M4) _(planned)_
├── supabase/
│   ├── migrations/              SQL migrations (source of truth for schema + RLS)
│   └── seed.sql                 Local dev seed
├── tests/
│   ├── db/                      RLS tests – run migrations in PGlite (real Postgres, WASM)
│   ├── unit/                    Vitest
│   └── e2e/                     Playwright (two browser contexts, fake media)
└── docs/                        Architecture, security model, manual tests, setup
```

## 2. Auth and room access

- **Auth: email + password via Supabase Auth.** Chosen over magic links because it works
  in local/dev without SMTP and Playwright can drive it deterministically. Sign-in goes
  through our own route handler so we can rate-limit per IP + email before it reaches Supabase.
- **Room creation** (`create_room` SQL function): generates
  - `slug`: 128-bit random, base64url (22 chars) – appears in the room URL.
  - `invite code`: separate 128-bit secret. Only its SHA-256 is stored. Shown to the host once
    (they can rotate it to get a new one while the room is still not full).
- **Allowlist**: `room_members` holds at most two rows per room (DB trigger enforces it, so it
  holds even under concurrent redemption). Host is inserted at creation; the invited guest is
  inserted when they redeem the code. Redeeming locks the room row (`FOR UPDATE`) and
  invalidates the invite.
- **Non-members** get the same "room not found" response whether or not the slug exists. RLS
  makes the room row invisible, so there is no oracle for guessing.
- **LiveKit tokens** _(M2)_: `POST /api/rooms/:slug/token` → verifies session, checks
  membership, mints a token with `identity = user.id`, `room = rooms.id`, TTL 10 min,
  `canPublishData`, no `roomAdmin`/`roomRecord`. The client never chooses identity or room.

## 3. Data model

All tables have RLS enabled. Helper `public.is_room_member(room_id)` is `SECURITY DEFINER`
to avoid recursive policies.

| Table               | Purpose / key columns                                                                                                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `profiles`          | `id → auth.users`, `display_name`, `avatar_hue`. Auto-created by trigger on sign-up. Readable by self and people who share a room.                                                             |
| `rooms`             | `id uuid`, `slug` (unique, 128-bit), `name`, `host_id`, `invite_code_hash`, `invite_expires_at`, `control_max_seconds`. `invite_code_hash` is never selectable by clients (column privileges). |
| `room_members`      | Allowlist: `(room_id, user_id)` PK, `role host                                                                                                                                                 | guest`. Max 2 per room (trigger). |
| `messages`          | `id`, `room_id`, `sender_id`, `client_id` (idempotency for optimistic UI), `seq` (bigint identity → total order), `kind text                                                                   | image                             | gif    | sticker | file`, `body`, `reply_to`, `meta jsonb`, `edited_at`, `deleted_at`. Clients can only update `body`/`deleted_at`on their own rows; a trigger stamps`edited_at` and clears content on delete (tombstone). |
| `message_reactions` | `(message_id, user_id, emoji)` PK, `room_id` denormalized for RLS + realtime filters.                                                                                                          |
| `message_receipts`  | Watermarks per `(room_id, user_id)`: `delivered_seq`, `read_seq`. Watermarks instead of per-message rows: O(1) writes and exact for an ordered two-person stream.                              |
| `attachments`       | `room_id`, `message_id`, `uploader_id`, `storage_path`, `mime_type`, `size_bytes`, `file_name` (sanitized), `width`, `height`.                                                                 |
| `moments`           | Shared collection: `room_id`, `message_id`, `saved_by`. Unique per `(room_id, message_id)`.                                                                                                    |
| `control_sessions`  | Audit log: `room_id`, `owner_id`, `controller_id`, `status requested                                                                                                                           | approved                          | denied | revoked | expired                                                                                                                                                                                                 | ended`, timestamps, `expires_at`, `end_reason`. |
| `rate_limits`       | Fixed-window counters keyed by `bucket:subject`. Only reachable through `SECURITY DEFINER` function called with the service role. No client access.                                            |

Storage: private bucket `attachments`, object path `<room_id>/<uuid>/<sanitized-name>`;
storage RLS checks `is_room_member(first path segment)`. Signed URLs with 5-minute expiry. _(M3)_

Realtime: `postgres_changes` on `messages`, `message_reactions`, `message_receipts` (RLS-filtered);
typing indicators and presence via **private** broadcast channels `room:<id>` authorized by
policies on `realtime.messages`. _(M3)_

## 4. Remote-control protocol _(M4)_

### Why a tab-capture-bound extension

Chrome gives no API to inject trusted input into a surface captured by `getDisplayMedia`,
and `getDisplayMedia` never tells a page or extension _which_ tab the user picked. If we let
the user pick freely and then asked the extension to guess the tab, the bound target could
differ from what the controller sees. That is unsafe.

So a **controllable share is started from the extension**: the owner clicks the DUO
extension's toolbar button on the tab they want to share, then "Share this tab with DUO". The extension:

1. records that `tabId` as the **only** authorized target,
2. calls `chrome.tabCapture.getMediaStreamId({ targetTabId, consumerTabId: duoTabId })`,
3. hands the stream id to the DUO page, which opens it with `getUserMedia({ chromeMediaSource: 'tab' })`
   and publishes it as the LiveKit screen-share track.

This way the captured pixels and the injected-input target are the same tab by construction.
Normal `getDisplayMedia` sharing of a screen or window still works, but it is view-only.
The UI says so.

### Injection: `chrome.debugger` (CDP `Input.*`)

| Option                                                                                            | Verdict                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Content-script synthesized events                                                                 | `isTrusted=false`. Many sites and native controls ignore them, typing into inputs needs hacks, no real focus/selection/scroll semantics, can't navigate cross-origin iframes. **Rejected.**                                                                                                                                                                                               |
| `chrome.debugger` + `Input.dispatchMouseEvent` / `dispatchKeyEvent` / `insertText` / `mouseWheel` | Trusted, real input. Works across sites, iframes and navigation. Cost: the `debugger` permission warning at install time, plus Chrome's unavoidable "DUO started debugging this browser" infobar while attached. **Chosen.** We attach only while a session is approved and detach the moment it ends. The infobar doubles as a browser-level indicator, and the UX explains it up front. |

### Transport and trust chain

```
Controller page ──LiveKit reliable data (topic "duo.ctl")──▶ Owner page ──runtime Port──▶ Extension SW ──CDP──▶ target tab
```

- **LiveKit data**: the sender identity is stamped by the SFU from the signed access token, so
  it can't be spoofed by other clients. Reliable mode gives ordered delivery.
- **Owner page → extension**: `chrome.runtime.connect(EXT_ID)` via `externally_connectable`,
  with `matches` limited to the DUO origin(s). No wildcards. Chrome itself enforces sender origin,
  and the service worker re-checks `port.sender.origin` against an allowlist.
- No `window.postMessage` bridge is used, so there's nothing for other scripts on the page to spoof.

### Messages (Zod schemas in `src/shared/control.ts`, shared with the extension)

Control plane: `ctl.request`, `ctl.approve {sessionId, expiresAt}`, `ctl.deny`, `ctl.revoke {reason}`,
`ctl.end`, `ctl.state` (heartbeat).
Input plane (only valid while approved): `in.move {x,y}`, `in.button {x,y,button,down,clickCount}`,
`in.wheel {x,y,dx,dy}`, `in.key {type, key, code, modifiers}`, `in.text {text}`.
Every input message carries `sessionId` and a monotonically increasing `seq`.
Coordinates are normalized `0..1` relative to the _video content box_ (letterboxing removed
on the controller side) and mapped in the extension to CSS pixels using
`Page.getLayoutMetrics().cssVisualViewport`. That covers DPR, zoom, scrollbars and resize.

### Validation at each hop

1. Owner page: sender identity === approved controller, `sessionId` current, not expired, schema valid.
2. Extension: schema valid again, port origin allowlisted, session active, target tab still
   alive, top URL not blocked (`chrome://`, `chrome-extension://`, `devtools://`, Chrome Web Store,
   the DUO origin), key-combo blocklist (e.g. Ctrl/Cmd+W/T/N/Q/L, Alt+F4, Ctrl+Shift+I…), rate limit.
3. Mouse moves are coalesced on the controller (one per animation frame, ≤60 Hz).

### Lifecycle

`idle → requested → approved → (revoked | expired | ended)`; `requested → denied`.
Hard stops: owner clicks Revoke (page or popup), emergency shortcut **Ctrl+Shift+Space**
(on Mac: ⌘+Shift+Space via the `commands` API, so it works even when the DUO tab isn't focused),
target tab closed or navigated to a blocked URL, share stopped, LiveKit disconnect, expiry
(default 15 min, per-room `control_max_seconds`). Every transition is written to `control_sessions`.

## 5. Effects pipeline _(M5)_

```
camera MediaStreamTrack
  → MediaStreamTrackProcessor (VideoFrame stream)   [worker]
  → MediaPipe ImageSegmenter (selfie) → mask         [worker, GPU delegate]
  → MediaPipe FaceLandmarker → 478 landmarks + transform matrix [worker]
  → WebGL2 compositor: background blur/replace + colour shader (VHS, B&W, night vision…)
  → Canvas2D/WebGL sprite pass for face-anchored props (ears, glasses, crown…)
  → OffscreenCanvas → MediaStreamTrackGenerator → processed track
```

Published through LiveKit's `LocalVideoTrack.setProcessor()`, which swaps the outgoing track
with `replaceTrack`, so there's no renegotiation. Graceful degradation: FPS is measured, and if it stays
under 22 fps, segmentation drops to 160p, then landmarks go to every other frame, then the effect turns off with a
toast. The camera track is stopped on unmount and leave (checked by verifying `readyState === 'ended'`).

## 6. Deviations from the spec (with reasons)

1. **`cacheComponents` disabled.** The nonce-based CSP requires per-request rendering, and nearly
   every DUO route is authenticated and per-user anyway, so prerendering gives little benefit.
2. **No Docker on the dev machine**, so local Supabase (`supabase start`) can't run. We use a hosted Supabase
   project for dev. RLS is still tested locally by running the _real migrations_ inside PGlite
   (Postgres compiled to WASM) with a minimal `auth`/`storage`/`realtime` schema stub.
   LiveKit dev runs the native `livekit-server --dev` binary (no Docker required).
3. **Controllable sharing starts from the extension** (see §4). This is required to make the
   "only the authorized tab" guarantee actually true.
4. **Receipts are watermarks**, not one row per message.
5. **`style-src` allows `'unsafe-inline'`.** Radix and LiveKit components set inline style attributes.
   Scripts stay nonce-locked with `'strict-dynamic'`, which is where the XSS risk is.
