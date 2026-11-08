# Publishing DUO Control on the Chrome Web Store

Everything the store asks for, ready to paste. The extension's behaviour is described in [EXTENSION.md](EXTENSION.md).

## 1. Build the package and images

```bash
npm run ext:build:store            # → extension/duo-control-1.0.0.zip (production origin only, no "key")
DUO_SHOTS=$PWD/extension/store-assets/out/raw npx playwright test tests/e2e/control.spec.ts -g approve
DUO_STORE_SHOTS=1 npx playwright test tests/e2e/store-shots.spec.ts
node extension/store-assets/render.mjs   # → extension/store-assets/out/*.png
```

Upload `extension/duo-control-1.0.0.zip`. Images are in `extension/store-assets/out/`:

| Field                  | File                                    |
| ---------------------- | --------------------------------------- |
| Store icon (128×128)   | `icon-128.png`                          |
| Screenshots (1280×800) | `screenshot-1.png` … `screenshot-5.png` |
| Small promo tile       | `promo-small.png` (440×280)             |

## 2. Store listing

**Name:** DUO Control

**Summary** (132 characters max):

> Let the person you're on a DUO call with click, scroll and type in one tab you share. Only after you approve.

**Category:** Communication. **Language:** English.

**Description:**

> DUO is a private space for two people: video calls that are end-to-end encrypted, chat that keeps everything you
> share, and things to do together while you talk. Watch a YouTube video in sync or share the tab your show is playing
> in, send voice and video notes, keep shared lists of films and places, try live filters and backgrounds with DUO
> Studio, react with emoji and snap photo-booth pictures. Rooms are invite-only and there's never room for a third
> person.
>
> DUO Control is DUO's companion extension, and it adds one thing: your person can take over a browser tab you share.
> Click, scroll, type, drag. Handy for helping with a form, a setting or a website while you're on a call. DUO works
> fully without it; you only need it to hand over control.
>
> How it works
> • In a DUO call, choose "Share a tab they can control", then click DUO Control on the tab you want to share.
> • Your person sees that tab and can ask for control. Nothing happens until you press Approve.
> • While they're in control you see a red banner with a countdown and a Revoke button. Pressing ⇧⌘9 (Ctrl+Shift+9 on
> Windows) stops it from anywhere, even outside Chrome.
>
> What the extension can and can't do
> • Only the one tab you picked. Never other tabs, other apps or browser settings.
> • Pasting and browser shortcuts are blocked, so your clipboard stays yours.
> • Chrome shows a "DUO Control started debugging this browser" bar while control is on. That's expected: it's how the
> input reaches the page.
> • It stores nothing, makes no network requests of its own, and only talks to DUO's website.
>
> Get started at https://duoforyou.cv

The listing leads with DUO, but the single purpose and permission answers below stay about the extension alone: the
store reviews what the code does, and an extension has to have one narrow purpose.

## 3. Privacy practices

**Single purpose:**

> Lets the other person in a DUO video call view and, after the user approves, control one browser tab the user chose to
> share.

**Permission justifications:**

| Permission      | Justification                                                                                                                                                                                                                                                                                                              |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `debugger`      | Delivers the approved person's mouse and keyboard input to the one tab the user shared, as real input events (Input.dispatchMouseEvent / dispatchKeyEvent). Attached only to that tab, only while the user has approved a control session, and detached as soon as it ends. Synthetic DOM events don't work on most sites. |
| `tabCapture`    | Captures the picture and sound of the tab the user chose to share, so the other person in the call can see it.                                                                                                                                                                                                             |
| `activeTab`     | Gives temporary access to the tab the user clicked the extension on. That's how the user picks which tab to share; the extension has no host permissions.                                                                                                                                                                  |
| `notifications` | Tells the user when the other person asks for control while DUO isn't the window in front, with Approve and Deny buttons.                                                                                                                                                                                                  |

**Remote code:** No, I am not using remote code. All code is in the package.

**Data usage** (tick these, and the three certifications):

- Website content: the shared tab's picture and sound are streamed into the user's own DUO call. Not stored.
- User activity: the other person's clicks, scrolling and keystrokes are applied to the shared tab during an approved
  session. Not stored.

Certify: not sold to third parties; not used or transferred for purposes unrelated to the single purpose; not used to
determine creditworthiness or for lending.

**Privacy policy URL:** https://duoforyou.cv/privacy (1.0.0 was submitted with the vercel.app address, which still works)

## 4. Distribution

**Visibility:** Unlisted. Only people with the link can find and install it, which suits a two-person app; it still
gets reviewed. Switch to Public later if you want it searchable.

**Regions:** all.

## 5. Test instructions for the reviewer

The reviewer needs two signed-in DUO users in the same room. Create two test accounts and a room they share, then paste
into "Test instructions":

> 1. In Chrome, sign in at https://duoforyou.cv/sign-in as user A (email / password below) and open the room
>    "Review". In a second Chrome profile, sign in as user B and open the same room.
> 2. Both press "Join call" (allow camera and microphone).
> 3. User A: Share → "Share a tab they can control", switch to any normal website tab, click the DUO Control toolbar icon
>    and press "Share this tab with DUO".
> 4. User B: press "Request control" on the shared screen. User A presses Approve. User B can now click, scroll and type
>    in A's tab. Revoke, or ⇧⌘9 / Ctrl+Shift+9, ends it.
>
> User A: … User B: …

## 6. After it's approved

1. Copy the extension's ID from the store dashboard.
2. Set `NEXT_PUBLIC_DUO_EXTENSION_ID` to it in Vercel (Production) and redeploy. DUO then connects to the store
   version, and the "Install DUO Control" dialog shows an **Add to Chrome** button instead of developer-mode steps.
3. Version 1.0.1 (built and ready, `extension/duo-control-1.0.1.zip`) also works on https://duoforyou.cv. Upload it
   from Package → Upload new package once 1.0.0 is approved, and update the listing's links to the new domain.
4. To ship an update: raise `VERSION` in `scripts/build-extension.mjs`, run `npm run ext:build:store` and upload the new
   zip.
