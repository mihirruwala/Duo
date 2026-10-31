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
