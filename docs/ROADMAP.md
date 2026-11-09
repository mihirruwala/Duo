# DUO: what's next, and why

_Written 2026-10-31, after M1–M4 shipped to production. Ordered by value ÷ effort._

## How this was decided

1. **What the spec still owes:** M5 (DUO Studio) is one of the three product pillars and is still "Coming soon".
   M6 (hardening) is required before calling v1 done.
2. **Friction found by using the product end to end:**
   - There's **no way to know your person is in the room**. You have to text them "I'm on". For a two-person app,
     "they're here, join?" is the core loop.
   - When the owner shares a tab for remote control, they **leave the DUO tab**. They then lose sight of their
     person's face and of the Revoke button, the safety control they most need.
   - You can't change your name or colour after signing up.
   - Chat messages that arrive while the dock is closed during a call are easy to miss.
3. **Operational gaps:** no CI on GitHub; dev, E2E and production share one Supabase project.

## Plan

| #    | Item                                                                                                                                                                                 | Why                                                              | Size                 |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- | -------------------- |
| 0 ✅ | **CI on GitHub** (typecheck, lint, unit + RLS tests on every push)                                                                                                                   | Free safety net now that the repo is connected; needs no secrets | S                    |
| 1 ✅ | **M5: DUO Studio**: background blur and replacement, face filters, live colour effects, published to the call                                                                        | Spec pillar; the remote person must actually see it              | L                    |
| 2    | **Knock & presence**: "Gabe is in the room" on Home and in the room; a gentle chime and a browser notification when your person joins the call                                       | The core loop of a two-person app                                | M                    |
| 3    | **Picture-in-picture control window**: while you share a tab, a small always-on-top window with your person's camera, the control status and Revoke                                  | Keeps the safety control visible where the owner actually is     | M                    |
| 4    | **Profile settings**: name, colour, delete account                                                                                                                                   | Basic expectation                                                | S                    |
| 5    | **In-call delight**: floating emoji reactions over the video; a "photo booth" that snaps both cameras into Moments                                                                   | Builds on Studio and Moments                                     | M                    |
| 6    | **M6 hardening**: accessibility pass, phone layouts for the call, error boundaries, storage cleanup on room delete, security write-up, optional end-to-end encryption (LiveKit E2EE) | Required for v1                                                  | L                    |
| 7 ✅ | **Ops**: separate production Supabase project, custom SMTP, Realtime public access off                                                                                               | Data hygiene                                                     | S (mostly dashboard) |

## Round 2 (2026-11-05): from researching how long-distance couples use calls

| #     | Item                                                                                                      | Why                                                                                                                   |
| ----- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 8 ✅  | **Pin / spotlight** your person (or yourself, or the shared content) in the call; tap a thumbnail to swap | The most-requested missing basic; during a share their face was stuck in a thumbnail                                  |
| 9 ✅  | **Watch Together**: synced YouTube inside the call                                                        | The #1 couples activity; screen-sharing Netflix etc. shows a black screen (DRM) and pipes film audio through the call |
| 10 ✅ | **Voice and video notes** in chat                                                                         | Time zones: something to wake up to                                                                                   |
| 11 ✅ | **Shared lists** (films, places, dates…), live for both, with "Watch" on YouTube links during a call      | The shared to-do of a couple; ties into Watch Together                                                                |
| 12 ✅ | **Hang-out mode**: low-bandwidth open line for hours (360p, Studio off, sleep mode)                       | "Parallel presence" is how couples actually use calls                                                                 |
| 13 ✅ | Watch Together for any site via the extension (Netflix etc. with each person's own account)               | Needs host permissions, so it's a separate, deliberate decision                                                       |

## DUO Studio technical plan (item 1)

- **Pipeline (all off the main thread):** camera track → `MediaStreamTrackProcessor` → transferable stream to a Worker
  → MediaPipe **ImageSegmenter** (selfie) + **FaceLandmarker** (VIDEO mode, GPU delegate) → **WebGL2** compositor on
  an OffscreenCanvas (background blur/replace, colour shaders, face-anchored sprites) → `VideoFrame` →
  `MediaStreamTrackGenerator` → published with LiveKit `LocalVideoTrack.replaceTrack()` (no renegotiation).
- **Assets self-hosted** (the CSP stays `'self'`): MediaPipe WASM copied from `node_modules` at build time; models
  (`selfie_segmenter`, `face_landmarker`) vendored under `public/models`. Background scenes are original artwork.
- **Budget:** 30 fps at 720p. Segmentation runs at reduced resolution, and landmarks every frame only when a face filter
  is on. FPS is measured; under sustained load it steps down (lower segmentation resolution → landmarks every other
  frame → effect off with a toast).
- **Verification:** the remote participant's _received_ frames are sampled in E2E and compared against the unprocessed
  camera, so "the other person sees it" is a test, not a claim.
