# Email and a custom domain

DUO sends two kinds of email: password reset links and, if you turn it on, sign-up confirmation. Supabase's built-in
email only reaches members of your Supabase team and is heavily rate-limited, so for real people you need your own
sender. These are the steps, in order.

## 1. A domain

Buy one (Cloudflare Registrar or Namecheap), then in Vercel → Project `duo` → Settings → Domains add it and follow the
DNS records Vercel shows. Then:

- Vercel → Environment Variables (Production): set `NEXT_PUBLIC_SITE_URL` to `https://<your-domain>` and redeploy.
  Search engines, link previews and invite links all use it.
- Supabase → Authentication → URL Configuration: set Site URL to `https://<your-domain>` and add
  `https://<your-domain>/**` to Redirect URLs (keep the vercel.app and localhost entries).
- DUO's domain is https://duoforyou.cv (done 2026-11-08). The DUO Control extension only talks to the origins it was
  built for: 1.0.0 knows only the vercel.app address, 1.0.1 (`npm run ext:build:store`) knows both.

## 2. An email provider (Resend)

1. Sign up at resend.com, add your domain under Domains and add the DNS records it shows (SPF, DKIM). Wait for
   "Verified".
2. Create an API key (Sending access).
3. Supabase → Authentication → Emails → SMTP Settings → Enable custom SMTP:
   - Sender email: `hello@<your-domain>`, sender name: `DUO`
   - Host `smtp.resend.com`, port `465`, username `resend`, password: the API key
4. Supabase → Authentication → Rate Limits: raise "emails per hour" to something sensible (e.g. 30).

## 3. Email templates

DUO verifies links with a one-time token at `/auth/confirm`, so a link works on whichever device opens the email (the
default Supabase link only works in the browser that asked for it). In Supabase → Authentication → Emails → Templates:

**Reset password**, subject `Reset your DUO password`:

```html
<h2>Choose a new password</h2>
<p>Someone (hopefully you) asked to reset the password for your DUO account.</p>
<p>
  <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password">Choose a new password</a>
</p>
<p>The link works once and expires in an hour. If you didn't ask for this, ignore this email.</p>
```

**Confirm signup**, subject `Confirm your DUO account`:

```html
<h2>Welcome to DUO</h2>
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/home">Confirm your email</a></p>
```

## 4. Turn on email confirmation (optional, recommended)

Once mail is flowing, Supabase → Authentication → Sign In / Providers → Email → turn **Confirm email** on. New accounts
then have to prove they own their address. The sign-up page already handles this ("Check your inbox").

Note for the E2E suite: it creates users through the admin API with `email_confirm: true`, so it doesn't depend on this
setting. The one test that signs up through the real form uses Resend's test inbox (`delivered+…@resend.dev`), so the
confirmation it triggers never bounces.

Status (2026-11-08): Resend verified for duoforyou.cv (region Tokyo), Supabase SMTP and both templates set, password
reset tested end to end on another device.
