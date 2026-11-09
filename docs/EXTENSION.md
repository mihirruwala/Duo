# DUO Control (Chrome extension)

DUO Control lets the person you're on a call with **click, scroll and type in one browser tab you share**, only after you
approve, and only until you stop it. It's needed only on the computer of the person **sharing** the tab. Viewing and
requesting control need nothing extra.

## Install (development / unpacked)

```bash
npm run ext:build                     # → extension/dist
```

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and choose `extension/dist`.
3. Pin **DUO Control** from the puzzle-piece menu so it's one click away.
4. Reload your DUO tab. In a call, **Share → "Share a tab they can control"** now shows the tab-picking steps.

The extension ID is fixed by the public key in `extension/manifest-key.txt`:
`kkdnhedcgfkimkdoabkegnkjdfnknpph`. DUO uses that ID by default. A Chrome Web Store build gets a different ID: set
`NEXT_PUBLIC_DUO_EXTENSION_ID` to it.

### Which DUO sites can talk to it

Only exact origins baked in at build time (`externally_connectable`, no wildcards). The default is `http://localhost:3000`
and `http://localhost:3001`. For production:

```bash
DUO_EXTENSION_ORIGINS="https://duo.example.com" npm run ext:build
```

Non-https origins are refused except localhost. Every other website gets no `chrome.runtime` at all (verified in E2E).

## Using it

1. In the call: **Share → Share a tab they can control**.
2. Switch to the tab you want to share, click **DUO Control** in the toolbar, then **Share this tab with DUO**.
   Chrome binds the capture to exactly that tab, and the extension remembers that tab ID as the _only_ controllable target.
3. Your person presses **Request control**. You see **Hand over control?** in DUO, plus a system notification if DUO isn't in front.
4. **Approve.** You'll see:
   - a red **Remote control active** banner in DUO with a countdown and **Revoke now**,
   - a coral frame, a "_Name_ is controlling this tab" banner and their cursor **on the shared tab itself**,
   - a red **CTRL** badge on the extension icon, with **Revoke** in its popup,
   - Chrome's own **"DUO Control started debugging this browser"** bar (see below).
5. Stop anytime, from any of these:
   - **Emergency stop: ⌘⇧9 (Mac) / Ctrl+Shift+9 (Windows/Linux).** A global shortcut: it works even when Chrome isn't focused.
     You can change it at `chrome://extensions/shortcuts`.
   - **Revoke now** in DUO, or **Revoke control now** in the extension popup.
   - Close Chrome's debugging bar, close the tab, stop sharing, or leave the call.

Sessions also end by themselves after the room's limit (default **15 minutes**, hard cap 60), and when the tab navigates to a
page that can't be controlled.

## Sync a show (1.1)

Watch Together for any site: you each open the same show on your own account (Netflix, Disney+, Prime Video, anything
with a `<video>`), and play, pause and skipping stay in step. The show plays in your own tab at full quality, with its
own sound; DRM isn't a problem because nothing is captured. **Both** people need the extension for this.

1. In the call: **Watch together → Sync a show** (this also pops out your person's face).
2. On the show's tab, click **DUO Control → Sync this tab's video with DUO**. Your person does the same ("Sync my tab"
   on the banner in DUO).
3. Whoever syncs second jumps to the first person's spot. From then on, whoever plays, pauses or skips leads, and the
   other tab follows (same engine as YouTube Watch Together: `src/features/call/watch/watch-sync.ts`).

How: the popup click gives `activeTab` access to that one tab, and the worker uses `scripting` to add
`sync-content.js` to it. That script finds the biggest `<video>` (ignoring small ones like trailers), follows it if the
player swaps it for a new episode, and talks only to the worker. Only the title (minus " | Netflix" and the like), the
site name and "play / pause at t" leave the tab. Netflix's player crashes if its `<video>` is seeked directly, so on
netflix.com the worker also adds a tiny helper in the page that seeks through Netflix's own player.

It stops when either of you presses **Stop syncing**, closes or reloads the tab (a full page load removes the script;
moving between episodes inside the player doesn't), leaves the call, or closes DUO.

Limits: the video has to be in the tab's main page (players inside another site's iframe aren't reached, because
`activeTab` only covers the page itself). Ads play out separately on each side.

## Permissions, and why

| Permission      | Why                                                                                                                                                                                                                                                                                          |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `debugger`      | Delivers **trusted** mouse/keyboard input into the shared tab via the Chrome DevTools Protocol (`Input.dispatchMouseEvent`, `Input.dispatchKeyEvent`). Attached only while a session you approved is active, detached the moment it ends. Chrome shows a warning about this at install time. |
| `tabCapture`    | Streams exactly the tab you picked to DUO.                                                                                                                                                                                                                                                   |
| `activeTab`     | Gives temporary access to the tab you clicked the extension on: that click is how you pick the tab.                                                                                                                                                                                          |
| `scripting`     | Sync a show: adds the sync script to the one tab you picked, using the `activeTab` grant from that popup click.                                                                                                                                                                              |
| `notifications` | The approval prompt when DUO isn't the tab in front.                                                                                                                                                                                                                                         |

**No host permissions** and no `tabs` permission: the extension can't read your other tabs or browsing history.

### Why `chrome.debugger` (and not a content script)?

We evaluated both:

|                                     | Content-script synthesized events                                          | `chrome.debugger` + CDP `Input.*` (**chosen**)                                         |
| ----------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Event trust                         | `isTrusted: false`. Many sites, frameworks and native controls ignore them | Real, trusted input (E2E asserts `isTrusted`)                                          |
| Typing                              | Needs per-site hacks; IME, selection and undo break                        | Works like a keyboard, including ⌘/Ctrl editing shortcuts                              |
| Scrolling, drag, double/right-click | Partial, fragile                                                           | Native                                                                                 |
| Navigation & iframes                | Script must re-inject per frame/origin; needs broad host permissions       | Survives navigation; no host permissions                                               |
| Cost                                | Broad host permissions (`<all_urls>`)                                      | The `debugger` install warning, plus Chrome's unavoidable debugging bar while attached |

The debugging bar can't be hidden by any extension. DUO tells you about it in the approval dialog. It's also a useful,
browser-level indicator that control is active, and closing it ends control.

## What the controller can and can't do

- ✅ Move, click, double-click, right-click, drag, scroll, type into fields, use editing shortcuts (select all, copy, cut, undo,
  redo, bold/italic, word/line navigation), click links, back/forward/reload of that tab.
- ❌ Any other tab, window, app or the browser UI. Input only ever goes to the one tab ID you shared.
- ❌ `chrome://` pages, extension pages, DevTools, the Chrome Web Store, `file://`, and DUO itself. If the tab navigates to one, control ends.
- ❌ Paste (⌘/Ctrl+V): it would insert **your** clipboard. Browser shortcuts (close/new tab/window, address bar, DevTools,
  print, save, bookmarks, tab switching, F-keys except F5) are dropped.
- Input is rate-limited (120 events/s, bursts of 240) and mouse moves are coalesced to ~30/s by the controller.

## Security model

```
Controller page ──LiveKit reliable data──▶ Owner DUO page ──chrome.runtime Port──▶ Extension ──CDP──▶ shared tab
```

1. **LiveKit data:** the sender identity is stamped by the media server from the signed access token, so participants can't spoof it.
2. **Owner DUO page:** accepts a request only if the matching `control_sessions` row (read under RLS) is `requested`, from that
   sender, to this owner, in this room. Forwards input only while _this_ session is approved, from the approved controller, before
   expiry. Every message is schema-validated (`src/shared/control.ts`).
3. **Extension:** connections only from allowlisted origins (Chrome-enforced + re-checked). Every message is schema-validated
   again. Input requires the current session ID, a strictly increasing sequence number (no replays), an unexpired session and a
   rate-limit token. Key combos and target URLs go through the policies above.
4. **Fail-safe:** if the DUO page closes, reloads or disconnects, the extension ends control immediately.
5. **Audit log:** `control_sessions` records request, approval time, expiry, and how each session ended (`owner_revoked`,
   `emergency_stop`, `expired`, `blocked_url`, `tab_closed`, `released`…). Clients can't write it directly; only the
   `control_request` / `control_transition` state machine can.

## Future option (not built): native companion

A native desktop helper could control whole apps or the OS. It needs OS accessibility permissions, code signing and a much
bigger trust surface, so it's deliberately out of scope.
