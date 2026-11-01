# DUO

A private video-call space for two people. Call, chat, share your screen, and with permission, let the other person take the wheel in a browser tab.

> Status: **v1 feature-complete**: rooms, video (end-to-end encrypted), chat, remote control, DUO Studio, presence & knock,
> picture-in-picture, settings, in-call fun. Security model: [`docs/SECURITY.md`](docs/SECURITY.md). See [`PROGRESS.md`](PROGRESS.md) for what's built and verified.
> Architecture, protocols and design decisions: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Stack

Next.js 16 (App Router, TypeScript strict) · Tailwind CSS 4 + shadcn/ui (Radix) · Supabase (Auth, Postgres + RLS,
Realtime, Storage) · LiveKit (M2) · MediaPipe (M5) · Vitest + PGlite (RLS tests) · Playwright.

## Quick start

Requirements: Node ≥ 20.9 (tested on 24), Google Chrome.

```bash
npm install
cp .env.example .env.local      # then fill in values (see below)
npm run dev                     # http://localhost:3000
```

### 1. Supabase (required)

1. Create a free project at [supabase.com](https://supabase.com/dashboard).
2. **Project Settings → API Keys**: copy the _Publishable key_ and create a _Secret key_. Put them in `.env.local`
   along with the _Project URL_ (Project Settings → Data API).
3. **Authentication → Sign In / Providers → Email**: keep Email enabled. For local development and the e2e suite,
   turn **"Confirm email" off** (otherwise each sign-up waits for an email link).
4. **Authentication → URL Configuration**: Site URL `http://localhost:3000`; add `http://localhost:3000/**` to
   Redirect URLs.
5. Apply the database schema:

   ```bash
   npx supabase login            # opens a browser once
   npm run db:link               # pick your project; asks for the DB password
   npm run db:push               # applies supabase/migrations/*
   ```

   No CLI? Paste each file in `supabase/migrations/` (in order) into **SQL Editor → Run**.

> Local Supabase (`supabase start`) also works if you have Docker. `supabase/config.toml` is already set up.

### 3. Remote control extension (optional, for the person sharing)

`npm run ext:build`, then load `extension/dist` at `chrome://extensions` (Developer mode → Load unpacked).
Full guide: [`docs/EXTENSION.md`](docs/EXTENSION.md).

## Deployment (Vercel + Supabase + LiveKit Cloud)

Live: **https://duo-virid-eta.vercel.app** (Vercel project `mihirruwalas-projects/duo`, functions in `dub1` next to
Supabase `eu-west-1`).

```bash
npx vercel@65.9.0 login                       # once
npx vercel@65.9.0 link --project duo          # once per checkout
npx vercel@65.9.0 deploy --prod               # deploy
E2E_BASE_URL=https://duo-virid-eta.vercel.app \
DUO_EXTENSION_ORIGINS=https://duo-virid-eta.vercel.app npx playwright test   # verify the live site
```

Production environment variables (Vercel → Settings → Environment Variables): everything in `.env.example`, with
`NEXT_PUBLIC_SITE_URL` set to the production URL. `SUPABASE_SECRET_KEY`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` and
`GIPHY_API_KEY` are stored as Vercel secrets. The extension for production users is built with
`DUO_EXTENSION_ORIGINS="https://duo-virid-eta.vercel.app" npm run ext:build`.

Supabase dashboard (one-time): **Authentication → URL Configuration**: Site URL = production URL, Redirect URLs include
`https://duo-virid-eta.vercel.app/**` and `http://localhost:3000/**`. **Authentication → Sign In / Providers → Email**:
Confirm email on. **Authentication → Emails → SMTP Settings**: a custom SMTP provider (required for confirmation emails
to reach anyone outside your Supabase team).

## Scripts

| Script                        | What it does                                                                                  |
| ----------------------------- | --------------------------------------------------------------------------------------------- |
| `npm run dev`                 | Dev server                                                                                    |
| `npm run build` / `npm start` | Production build / serve                                                                      |
| `npm run check`               | Typecheck + lint + unit/RLS tests                                                             |
| `npm test`                    | Vitest: unit tests and **RLS tests** (real migrations in PGlite, no backend needed)           |
| `npm run test:e2e`            | Playwright against a production build in Chrome. Backend specs auto-skip without Supabase env |
| `npm run format`              | Prettier                                                                                      |
| `npm run db:push`             | Apply migrations to the linked Supabase project                                               |
| `npm run db:types`            | Regenerate DB types from the linked project                                                   |
| `npm run ext:build`           | Build the Chrome extension into `extension/dist` (`DUO_EXTENSION_ORIGINS` for production)     |

## Testing

- **RLS / database:** `npm test` boots Postgres-in-WASM (PGlite), emulates Supabase's roles, `auth.uid()` and its
  permissive default grants, then runs every migration and asserts outsiders can't read or write anything.
- **E2E:** `npm run test:e2e`. The two-user room test needs Supabase configured with _Confirm email_ off. It
  creates throwaway users named `duo-e2e-*@example.com`.

## Project layout

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#1-folder-structure).

## Security model (short)

Invite-only rooms with a strict two-person allowlist enforced in Postgres. 128-bit room slugs and single-use invite
codes (stored hashed, delivered in the URL fragment). Row Level Security on every table. Rate limits enforced inside
the database. Per-request nonce CSP. Details in the architecture doc. A full security write-up lands in M6.
