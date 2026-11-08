# DUO on Google Play

The Android app is a Trusted Web Activity: a small app (`cv.duoforyou.app`) that opens https://duoforyou.cv full
screen in Chrome, with no browser bar. Deploying the website updates the app; a new Play release is only needed when the
Android wrapper itself changes (icon, name, colours).

## Building

One-time toolchain (already set up on this Mac): Bubblewrap in `~/.bubblewrap/tools`, JDK 17 in `~/.bubblewrap/jdk`
(Microsoft OpenJDK, because GitHub's Temurin downloads were failing), Android SDK in `~/.bubblewrap/android_sdk`, paths
in `~/.bubblewrap/config.json`.

```bash
node scripts/android-app.cjs          # first build, or a rebuild of the same version
node scripts/android-app.cjs --bump   # next version code: every upload to Play needs a new one
node scripts/render-app-icons.mjs     # after changing src/app/icon.svg
```

The app needs Android 7.0 or newer (minSdkVersion 24, required by android-browser-helper). Gradle 8.11.1 was installed
from a mirror and checked against the official SHA-256, because GitHub release downloads kept failing from this network.

Output: `android/app-release-bundle.aab` (upload this to Play) and `android/app-release-signed.apk` (install it on a
phone directly to try it). Only `android/twa-manifest.json` is committed; the rest is regenerated.

**Upload key:** `~/.android-keys/duo-upload.jks`, password in the macOS Keychain (service "DUO Android upload key").
Back both up somewhere safe. Google holds the real app-signing key (Play App Signing); the upload key only proves an
upload came from you, and Google can reset it if it's lost, but that takes days.

## Linking the app to the site (no URL bar)

`public/.well-known/assetlinks.json` lists the SHA-256 fingerprints of keys allowed to open duoforyou.cv full screen.
The build adds the upload key's. After the first upload, Play Console → Test and release → Setup → App signing shows
the **app signing key** SHA-256: add it to the same array (keep both), deploy, and check with
https://developers.google.com/digital-asset-links/tools/generator.

## Play Console

Developer account: $25 once, with identity verification. New personal accounts must run a **closed test with at least
12 testers for 14 days** before production access.

**App:** name DUO, default language English, app (not game), free.

**Store listing**

- Short description (80 max): `Video calls, chat and watching together, just for the two of you.`
- Full description:

  > DUO is a private space for two people. Video calls are end-to-end encrypted, and a room holds exactly two people:
  > the database refuses a third.
  >
  > Watch a YouTube video together in sync (either of you can pause), or have one of you share the tab your show is
  > playing in. Chat sits beside the call with voice and video notes, photos, stickers, GIFs and shared lists for the
  > films and places you keep meaning to get to. DUO Studio adds backgrounds and face filters your person actually sees.
  > You can see when they're around, and knock.
  >
  > Rooms are invite-only. There are no ads and no trackers, and calls are never recorded.

- App icon (512×512): `public/icons/maskable-512.png`
- Feature graphic (1024×500) and phone screenshots: `extension/store-assets/out/play-*.png`
  (`DUO_STORE_SHOTS=1 npx playwright test tests/e2e/store-shots.spec.ts`, then `node extension/store-assets/render.mjs`)
- Category: Communication. Contact email: ruwalamihir@gmail.com. Website: https://duoforyou.cv
- Privacy policy: https://duoforyou.cv/privacy

**App content**

- Ads: no.
- App access: login required. Use the reviewer accounts (duo-review-a / duo-review-b, see the Chrome Web Store notes)
  and say they share a room called "Review".
- Target audience: 18 and over.
- Content rating questionnaire: Communication; users can interact and exchange content (yes); shares location (no);
  digital purchases (no).
- Data safety:
  - Collected (all required for the app to work, none shared with third parties, none optional except what people
    choose to send): Name, Email address (account); Photos, Videos, Voice or sound recordings, Files and docs, Other
    in-app messages (chat between the two members of a room).
  - Purposes: App functionality, Account management.
  - Encrypted in transit: yes. Users can request deletion: yes, at https://duoforyou.cv/privacy#delete-account.
  - Not collected: location, contacts, payment info, app activity, device IDs, analytics.
- Account deletion URL: https://duoforyou.cv/privacy#delete-account
