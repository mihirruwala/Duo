# DUO

A private video-call space for two people. Call, chat, share your screen, and with permission, let the other person take the wheel in a browser tab.

I built it for one person, so everything is designed around exactly two people in a room. Besides calling and chat you can:

- watch YouTube together in sync, or share a tab with a show playing (Watch mode)
- pin each other big, react with emoji, take photo-booth pictures
- send voice and video notes
- keep shared lists (films to watch, places to go)
- see when the other person is around and knock
- add backgrounds and face filters with DUO Studio
- let the other person control a tab you share, through a small Chrome extension

Calls are end-to-end encrypted. [`PROGRESS.md`](PROGRESS.md) lists what's built and how each part was tested,
[`docs/SECURITY.md`](docs/SECURITY.md) covers the security model, and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
the design.

## Stack

Next.js 16 (App Router, strict TypeScript), Tailwind CSS 4 with shadcn/ui, Supabase (auth, Postgres with RLS,
Realtime, Storage), LiveKit for calls, MediaPipe for Studio effects, Vitest and PGlite for tests, Playwright for E2E.

## Running it locally

You need Node 20.9 or newer (I use 24) and Google Chrome.

```bash
npm install
cp .env.example .env.local      # then fill in the values below
npm run dev                     # http://localhost:3000
```

### 1. Supabase

1. Create a free project at [supabase.com](https://supabase.com/dashboard).
2. In Project Settings → API Keys, copy the publishable key and create a secret key. Put both in `.env.local`, along
   with the project URL from Project Settings → Data API.
3. In Authentication → Sign In / Providers → Email, keep email enabled. For local development and the E2E tests,
   turn "Confirm email" off, otherwise every sign-up waits for an email link.
4. In Authentication → URL Configuration, set the Site URL to `http://localhost:3000` and add
   `http://localhost:3000/**` to the redirect URLs.
5. Apply the database schema:

   ```bash
   npx supabase login            # opens a browser once
   npm run db:link               # pick your project; asks for the DB password
   npm run db:push               # applies supabase/migrations/*
   ```

   Without the CLI, paste each file in `supabase/migrations/` into the SQL editor, in order, and run it.

Local Supabase (`supabase start`) works too if you have Docker; `supabase/config.toml` is already set up.

### 2. LiveKit

For local development, `npm run livekit` starts a LiveKit dev server on `ws://localhost:7880`, and the defaults in
`.env.example` already point at it. To use LiveKit Cloud instead, create a project at cloud.livekit.io and copy the
URL, API key and secret from Settings → Keys.

### 3. Remote control extension (optional, only for the person sharing)

Run `npm run ext:build`, then load `extension/dist` at `chrome://extensions` (Developer mode → Load unpacked). The full
guide is in [`docs/EXTENSION.md`](docs/EXTENSION.md). Publishing it on the Chrome Web Store is covered in
[`docs/CHROME_WEB_STORE.md`](docs/CHROME_WEB_STORE.md).

GIFs need a GIPHY API key in `GIPHY_API_KEY`; without it the GIF button is hidden.

## Deploying (Vercel, Supabase, LiveKit Cloud)

It runs at https://duo-virid-eta.vercel.app (Vercel project `mihirruwalas-projects/duo`, functions in `dub1` so they
sit next to Supabase in `eu-west-1`).

```bash
npx vercel@65.9.0 login                       # once
npx vercel@65.9.0 link --project duo          # once per checkout
npx vercel@65.9.0 deploy --prod               # deploy
E2E_BASE_URL=https://duo-virid-eta.vercel.app \
DUO_EXTENSION_ORIGINS=https://duo-virid-eta.vercel.app npx playwright test   # test the live site
```

In Vercel → Settings → Environment Variables, set everything from `.env.example`, with `NEXT_PUBLIC_SITE_URL` set to
the production URL. `SUPABASE_SECRET_KEY`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` and `GIPHY_API_KEY` are stored as
secrets. Build the extension for production with
`DUO_EXTENSION_ORIGINS="https://duo-virid-eta.vercel.app" npm run ext:build`.

On the Supabase dashboard, once:

- Authentication → URL Configuration: Site URL is the production URL, and the redirect URLs include
  `https://duo-virid-eta.vercel.app/**` and `http://localhost:3000/**`.
- Authentication → Sign In / Providers → Email: turn "Confirm email" on.
- Authentication → Emails → SMTP Settings: add your own SMTP provider. Without one, confirmation emails only reach
  members of your Supabase team.

## Scripts

| Script                        | What it does                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------ |
| `npm run dev`                 | Dev server                                                                                       |
| `npm run build` / `npm start` | Production build / serve                                                                         |
| `npm run check`               | Typecheck, lint, unit and RLS tests                                                              |
| `npm test`                    | Vitest: unit tests and RLS tests (real migrations in PGlite, no backend needed)                  |
| `npm run test:e2e`            | Playwright against a production build in Chrome. Specs that need a backend skip without Supabase |
| `npm run format`              | Prettier                                                                                         |
| `npm run db:push`             | Apply migrations to the linked Supabase project                                                  |
| `npm run db:types`            | Regenerate database types from the linked project                                                |
| `npm run ext:build`           | Build the Chrome extension into `extension/dist` (`DUO_EXTENSION_ORIGINS` for production)        |
| `npm run ext:build:store`     | Build the Chrome Web Store package (`extension/duo-control-<version>.zip`)                       |

## Tests

`npm test` runs Postgres compiled to WASM (PGlite), sets up Supabase's roles, `auth.uid()` and its default grants, runs
every migration, and checks that people outside a room can't read or write anything in it.

`npm run test:e2e` drives two browsers through real calls, chat and the rest. It needs Supabase configured with
"Confirm email" off, and creates throwaway users named `duo-e2e-*@example.com`.

## Code layout

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#1-folder-structure).

## Security, briefly

Rooms are invite-only, and Postgres enforces the two-person limit. Room slugs are 128-bit random, and invite codes are
single-use, stored hashed and passed in the URL fragment so they never reach server logs. Every table has row level
security, rate limits run inside the database, and each page gets its own CSP nonce. The full write-up is in
[`docs/SECURITY.md`](docs/SECURITY.md).
