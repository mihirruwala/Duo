# iOS app

`ios/` is a small native app (`cv.duoforyou.app`, iOS 16+, iPhone and iPad) that opens https://duoforyou.cv full screen
in a web view, like the Android app. Same accounts, same calls: everything is the website.

What the app adds over Safari:

- No address bar or tabs; DUO's icon on the home screen.
- Camera and microphone: iOS asks once for the app, and DUO's own pages then get them without a second web prompt.
  Other sites never do.
- Calls play inline and the other person's sound starts on its own.
- The screen stays on while you're in a room (`/r/…`), for long calls and hang-out mode.
- Links to other sites open in an in-app Safari sheet; `mailto:` and the like go to their apps.
- `duo://…` links open DUO at that path (`duo://r/<room>`, `duo://join#<code>`).
- An offline screen with Try again, and a reload if iOS kills the page in the background.

## Build and run

Open `ios/DUO.xcodeproj` in Xcode, pick an iPhone (or a simulator) and press Run. From the command line:

```bash
cd ios
xcodebuild -project DUO.xcodeproj -scheme DUO -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build build
xcodebuild -project DUO.xcodeproj -scheme DUO -destination 'generic/platform=iOS' -derivedDataPath build -allowProvisioningUpdates build
```

The simulator has no camera, so calls need a real iPhone.

## Signing

The project signs with team `8JWHPDKVY6` (Mihir Ruwala), which is a free personal team. That means:

- Apps installed from Xcode stop opening after 7 days; run it from Xcode again to renew.
- The first time, the iPhone asks you to trust the developer: Settings → General → VPN & Device Management.
- No TestFlight, no App Store, no Associated Domains (so invite links in Messages open Safari, not the app).

For TestFlight or the App Store, join the Apple Developer Program, switch `DEVELOPMENT_TEAM` to the paid team, then
Product → Archive in Xcode. App Review is stricter about apps that are mainly a website (guideline 4.2); DUO's calls and
camera access help, but expect questions.

## Not done in the app (yet)

- Push notifications: the web app's notifications don't work inside an iOS web view. Knocks only show while DUO is open.
- Calls pause when the app goes to the background (iOS stops the camera and the web view); there's no CallKit.
- Sharing your screen isn't possible from a web page on iPhone, same as in Safari.
- Universal links (needs the paid program and an `apple-app-site-association` file on the site).

The app icon is rendered from `ios/icon.svg` (the DUO mark with padding, on the app background).
