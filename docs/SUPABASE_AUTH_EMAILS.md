# Supabase auth emails — branded + sent via Resend (N5)

Supabase sends its own auth emails (password reset, magic sign-in link, email
confirmation, email-change) — these do **not** go through `lib/mailer.js`. By
default they come from Supabase's shared sender with plain Supabase styling. This
makes them (a) look like our other mail and (b) send from **our** verified Resend
domain so they land in the inbox with SPF/DKIM alignment.

Two dashboard actions for Peter (Supabase → project `acxepovfklgthxmteqxr`):

## 1. Point Supabase auth email at our Resend SMTP

**Authentication → Emails → SMTP Settings → Enable Custom SMTP:**

| Field | Value |
|---|---|
| Sender email | `notifications@mail.stemfra.com` |
| Sender name | `Stemfra` |
| Host | `smtp.resend.com` |
| Port | `465` (SSL) — or `587` for STARTTLS |
| Username | `resend` |
| Password | the **`RESEND_API_KEY`** (same key already in `.env` / GitHub secrets) |

`mail.stemfra.com` is already verified for sending in Resend (DKIM+SPF live in the
Cloudflare zone), so no new DNS is needed. After saving, use Supabase's "send test
email" to confirm delivery.

> Resend free tier is 100 emails/day shared across ALL sending (transactional +
> these auth emails). Watch the ceiling; upgrade to Pro when tenant volume nears it.

## 2. Paste the branded templates

**Authentication → Email Templates.** For each template below, set the **Subject**
and replace the **Message body (HTML)** with the contents of the matching file in
[`docs/supabase-auth-templates/`](supabase-auth-templates/):

| Supabase template | Subject | HTML file |
|---|---|---|
| Confirm signup | `Confirm your email` | `confirm-signup.html` |
| Magic Link | `Your sign-in link` | `magic-link.html` |
| Reset Password | `Reset your password` | `reset-password.html` |
| Change Email Address | `Confirm your new email address` | `change-email.html` |

Each file is a complete HTML document rendered through our Case 9 base
(`templates/baseEmail.js`, Stemfra brand) with the Supabase action link embedded
as `{{ .ConfirmationURL }}` — Supabase fills that in at send time. (The "Invite
user" template is intentionally left as-is: we provision owners, we don't invite.)

## Regenerating the files

The HTML is generated from `templates/authEmails.js`. If the base or copy changes,
re-export:

```bash
node -e "const fs=require('fs'),a=require('./templates/authEmails.js');
for (const [n,f] of [['confirm-signup','confirmSignup'],['magic-link','magicLink'],['reset-password','resetPassword'],['change-email','changeEmail']])
  fs.writeFileSync('docs/supabase-auth-templates/'+n+'.html', a[f]().html);"
```

Preview live (dev): `/dev/preview/auth-{confirm-signup,magic-link,reset-password,change-email}`.

## Notes

- **One project = one global template set.** These are Stemfra-branded for both CMS
  owners AND tenant member accounts (a member's magic link reads a neutral "Sign in
  to your account"). Per-tenant-branded auth mail would need a separate sending path
  and is out of scope.
- **Redirect allowlist.** CMS flows already have `cms.stemfra.com/**` +
  `localhost:5180/**` allowlisted (Authentication → URL Configuration). Member
  magic-links redirect to the tenant site (`/account`), so each live tenant host (and
  `*.pages.dev` in dev) must also be allowlisted for member sign-in to complete —
  track this as tenants go live.
- **`{{ .Token }}`** (6-digit OTP) is available if we ever want code-based instead of
  link-based emails; today all four are link-based via `{{ .ConfirmationURL }}`.
