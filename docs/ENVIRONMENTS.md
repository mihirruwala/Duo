# Environments

Two Supabase projects, same region (eu-west-1), same migrations:

| Project   | Ref                    | Used by                                                       |
| --------- | ---------------------- | ------------------------------------------------------------- |
| `Duo`     | `vdawcffvxzfnlasjzepb` | Production: https://duoforyou.cv (Vercel Production env vars) |
| `Duo dev` | `rjvxhtoazbgtjcjjpxye` | `next dev`, local E2E runs (`.env.local`)                     |

LiveKit, Giphy and the extension ID are shared; LiveKit rooms are named by room ID, so the two can't collide.

## Env files (all git-ignored)

- `.env.local`: dev. Next loads it for `next dev`, `next build` and `next start`, and Playwright loads it too.
- `.env.live`: production's `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and
  `SUPABASE_SECRET_KEY`. Next never loads it. Playwright reads it only when `E2E_BASE_URL` points at a deployed site,
  so tests against https://duoforyou.cv can create and clean up their users there.

## Differences on purpose

|                        | Production                                      | Dev                                                 |
| ---------------------- | ----------------------------------------------- | --------------------------------------------------- |
| Email                  | Resend SMTP, custom templates, Confirm email on | Supabase's built-in mailer, sign-ups auto-confirmed |
| Site URL / redirects   | duoforyou.cv, the vercel.app address, localhost | localhost and 127.0.0.1 on 3000, 3100, 3200         |
| Realtime public access | Off (private channels only)                     | Off                                                 |

Dev has no custom SMTP, so Supabase won't let its email templates be edited, and it won't send mail to anyone outside
the Supabase team. Nothing in dev or E2E needs real mail: tests create confirmed users through the admin API, and the
password-reset test uses an admin-generated link.

## Database changes

Write a migration in `supabase/migrations/`, then apply it to dev first, test, and then production:

```bash
# dev (password in the macOS Keychain, "DUO dev Supabase db password")
npx supabase db push --db-url "postgresql://postgres.rjvxhtoazbgtjcjjpxye:$(security find-generic-password -s 'DUO dev Supabase db password' -w)@aws-0-eu-west-1.pooler.supabase.com:5432/postgres"

# production (the CLI is linked to it)
npx supabase db push
```

Check both are in step with `npx supabase migration list` (production) and the same `--db-url` for dev.

## Vercel

Production env vars point at `Duo`. Preview env vars still point at `Duo` too; nothing deploys previews today (every
deploy is `--prod`). If previews start being used, move their three Supabase vars to `Duo dev` in the Vercel dashboard
(the CLI's `env rm` would remove a var that's shared between Production and Preview from both).
