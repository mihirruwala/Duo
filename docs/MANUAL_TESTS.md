# DUO: manual two-device test checklist

Automated tests use Chrome's fake camera/mic and a canvas stand-in for screen capture. These checks cover what
automation can't: real hardware, the OS screen picker, and real networks. Run them before each release.

**Setup:** two machines (or one machine + a phone hotspot laptop), Chrome on both, two accounts in the same room.
Tick each box and note the Chrome version and OS.

## M2: video, audio, screen sharing

### Pre-call studio

- [ ] Camera preview appears within ~2 s and is mirrored for you.
- [ ] Speaking moves the mic meter; silence keeps it low.
- [ ] Switching camera / microphone in the dropdowns changes the preview / meter immediately.
- [ ] Speaker test (🔊 button) plays a chime through the selected output (try headphones vs speakers).
- [ ] Turning the camera off in pre-call turns the **camera light off**.
- [ ] Denying camera permission shows a clear message (not a blank box); re-allowing via the address bar works after reload.

### In call

- [ ] Both people see and hear each other; no echo with speakers on (echo cancellation).
- [ ] Mute (button and ⌘/Ctrl+D) → the other side sees the muted mic icon and hears nothing.
- [ ] Camera off (button and ⌘/Ctrl+E) → camera light turns **off**; the other side sees your avatar.
- [ ] Device menu (˄ next to mic/camera) switches devices live; the other side keeps seeing/hearing you.
- [ ] Speaker switch from the menu moves call audio to the chosen output.
- [ ] Speaking ring appears around whoever talks.
- [ ] Connection-quality icon shows on the remote tile; throttle one side (DevTools → Network → Slow 4G) → it degrades.
- [ ] Turn Wi-Fi off for ~5 s on one machine → "Reconnecting…" banner → recovers on its own when Wi-Fi returns.
- [ ] Opening the same room in a second tab on one machine → the first tab shows "You joined from another tab".
- [ ] Leaving → "You left the call", camera light off; the other side sees "<name> left the call".
- [ ] Rejoin works without reloading the page.

### Screen sharing

- [ ] Share **a tab** (with "Share tab audio" ticked, play a YouTube video) → the other side sees it live and hears the tab audio.
- [ ] Share **a window** and **the entire screen**. macOS: first time requires System Settings → Privacy & Security →
      Screen Recording → enable Chrome, then restart Chrome.
- [ ] The viewer sees "<name> is sharing their screen" with the LIVE badge; camera thumbnails remain visible.
- [ ] Full-screen button on the viewer side works; Esc exits.
- [ ] Stop from DUO's **Stop sharing** → both sides return to the camera layout.
- [ ] Stop from Chrome's native **"Stop sharing"** bar → both sides return to the camera layout.
- [ ] While one person shares, the other's Share button is disabled with "<name> is sharing".
- [ ] Cancelling the picker shows no error.

### Access control

- [ ] A third account opening the room URL sees "Room not found".
- [ ] Signing out in one tab, then clicking Join call in another → "Your session expired" message.

## M3: chat

- [ ] Messages appear on the other machine in well under a second, on different networks (e.g. one on a phone hotspot).
- [ ] Turn Wi-Fi off on one side, send messages from the other, turn Wi-Fi back on → the missed messages appear without reload.
- [ ] Hover a message: Reply / React / Copy / (Edit / Delete on yours) / bookmark on photos, GIFs and stickers. Tab to a message with
      the keyboard: the same actions appear.
- [ ] Paste a screenshot (⌘V) into the composer → it uploads with progress and appears on both sides.
- [ ] Drag a PDF onto the chat → "Drop to send" overlay → uploads; the other side downloads it with the right name.
- [ ] Try a 30 MB file and an .svg → clear refusal messages.
- [ ] Open a photo → full-screen viewer; ←/→ moves between photos/GIFs; +/−/0 and the mouse wheel zoom; Esc closes.
- [ ] Search GIFs (with a GIPHY key) → send → the other side sees it; "Powered by GIPHY" shown in the picker.
- [ ] Resize the chat from its top-left corner; minimize → unread badge counts new messages; reload → size and open state remembered.
- [ ] During a call, the chat floats above the video and doesn't block the call controls.
- [ ] Phone-width window: chat opens full screen and is usable.
- [ ] Sign in on a second device as the same user: full history, reactions and Moments are there.

## M4: remote control (needs the extension on the sharer's machine: docs/EXTENSION.md)

- [ ] Fresh install: Chrome shows the `debugger` permission warning; the popup says "Open your DUO call first" until DUO is open.
- [ ] In a call: Share → "Share a tab they can control" → steps dialog → on another tab click DUO Control → "Share this tab
      with DUO" → you return to DUO and the other machine sees that tab live.
- [ ] Popup on a `chrome://settings` tab and on the Chrome Web Store: sharing is refused with a clear message.
- [ ] Controller: Request control → owner gets the in-page dialog. With DUO in a background window, a system notification
      appears instead; Approve from the notification works.
- [ ] After Approve: red banner + countdown in DUO, red CTRL badge, coral frame + banner + named cursor on the tab, Chrome's
      debugging bar. Controller sees "You're controlling … · mm:ss".
- [ ] Controller can: click buttons, double-click a word to select it, right-click (context menu opens on the owner side),
      drag a slider, scroll a long page with the trackpad, type into a search box, ⌘/Ctrl+A / C / Z, follow links, use back/forward.
- [ ] Controller can't: ⌘/Ctrl+V (nothing pasted), ⌘/Ctrl+W/T/L (no effect on the owner's browser), switch tabs, open DevTools.
- [ ] Mapping stays accurate after: resizing the owner's window, zooming the shared page to 150%, on a Retina and a 1× display,
      with the controller's DUO window at different sizes/aspect ratios.
- [ ] **⌘⇧9 / Ctrl+Shift+9** ends control instantly: with DUO focused, with the shared tab focused, and with another app
      (e.g. Finder) focused.
- [ ] Each also ends control instantly: Revoke in DUO, Revoke in the popup, closing Chrome's debugging bar, closing the shared
      tab, navigating it to `chrome://settings`, stopping the share, the controller pressing Hand back, either person leaving.
- [ ] After a session ends, the frame/banner/cursor disappear from the tab and the badge clears.
- [ ] Leave a session running past the room's limit (set `control_max_seconds` to 60 in the DB) → it ends by itself on both sides.
- [ ] Supabase → `control_sessions` shows each session with status, approval time and end reason.

## M5: DUO Studio (real camera, ideally on a mid-range laptop too)

- [ ] Pre-call: Filters & backgrounds → each face filter (Puppy, Kitty, Cool shades, Big eyes, Crown, Floating hearts,
      Confetti) sits on your face, follows you as you move and tilt your head, and disappears when you leave the frame.
- [ ] Blur: your outline is clean (hair, shoulders), the background is blurred, and the strength slider changes it live.
- [ ] Each background scene and your own uploaded photo replace the background without flicker at the edges.
- [ ] Each live effect looks right; VHS shows colour fringing, scanlines and rolling bands.
- [ ] In the call, the other person sees the same look; switching looks doesn't freeze or reconnect the call.
- [ ] `?debug=1`: the read-out stays around 30 fps with ms/frame well under 33 on your machine. Note the numbers here.
- [ ] On an older laptop: if it struggles, you get "quality lowered", and as a last resort backgrounds/filters switch off
      with a message; the call keeps going.
- [ ] Turn everything off, then leave the call: the camera light goes off.

## Presence, PiP, settings, fun, E2EE

- [ ] Home on one machine, open the room on the other: Home card says "<name> is in the room" within a few seconds; a chime
      plays; with DUO in a background tab and notifications allowed, a system notification appears.
- [ ] Knock from the pre-call banner: the other side hears the chime and sees "is knocking", on Home or in the room.
- [ ] Start a call: the other person's Home card shows "is in the call · Join"; one click gets them in.
- [ ] Share a tab for control: the mini window pops up on top; switch tabs and it stays visible; Approve and Revoke work from it.
- [ ] Settings: rename yourself and change colour; the other person sees it after reloading. Delete a test account: wrong password
      refused, then everything for that account is gone.
- [ ] Reactions float up on both screens; photo booth: both see 3-2-1, either can cancel; the photo appears in chat and Moments.
- [ ] Phone (or a narrow window): call controls fit, More holds reactions, Effects and Photo booth; chat opens full screen.
- [ ] Call header shows "End-to-end encrypted" on both sides; turning it off in room settings removes the badge on the next join.
- [ ] Screen reader (VoiceOver): landing, sign-in, room and call controls are announced with sensible names.

## Pin, Watch Together, notes, shared lists

- [ ] In a call, hover the other person's tile → Pin: they fill the stage, you float in the corner. Click your small tile to
      swap; the other side's layout doesn't change. Rejoin: the pin is remembered.
- [ ] While they share their screen, pin them: their face is big, the share keeps playing as a thumbnail; tap it to bring it back.
- [ ] Watch together → paste a YouTube link: it starts for both. Pause, play and skip from either side; positions stay within ~1 s.
      Pin your person during the film: the video keeps playing in the thumbnail. End from either side.
- [ ] Join a call where the other person is already watching: you jump to the same video and moment.
- [ ] Without headphones, the other person hears the film through your mic (expected; the tip says so).
- [ ] Hold a conversation by voice notes: record, discard, send; play at 1×/1.5×/2×. Video note: live preview, plays on the
      other side with sound. Safari records `audio/mp4`/`video/mp4` and they play in Chrome too.
- [ ] Lists tab: a template creates a list; add, tick off, edit and delete items on one machine and watch them change on the
      other. A YouTube link in a list shows "Watch" while you're in a call and starts it for both.
