// Supabase Auth email templates (N5 — "Forgot Login Information" + signup/magic
// link/email-change). Supabase sends these ITSELF (through our Resend SMTP), NOT
// through lib/mailer.js — so they must be self-contained HTML that Supabase's Go
// templating fills in at send time. We render them through the same Case 9 base
// (templates/baseEmail.js, Stemfra brand mode) so a password reset looks like the
// rest of our mail. The rendered HTML is pasted into
//   Supabase Dashboard → Authentication → Email Templates
// (one per template). See docs/SUPABASE_AUTH_EMAILS.md for the runbook.
//
// Supabase template variables (Go text/template) are embedded RAW and survive
// escapeHtml (which only touches & < > " ') untouched:
//   {{ .ConfirmationURL }}  the action link (confirm / magic-link / reset / …)
//   {{ .Token }}            6-digit OTP alternative (unused — we're link-based)
//   {{ .SiteURL }} {{ .Email }} {{ .RedirectTo }}
//
// NOTE: one Supabase project = ONE global set of auth templates, so these are
// Stemfra-branded for BOTH CMS owners and tenant member accounts (a member's
// magic link reads "Sign in" — brand-neutral enough to fit a Stemfra-powered
// portal). Per-tenant-branded auth mail would need a separate sending path.

const { renderEmail } = require('./baseEmail');

const HELP = [{ label: 'Help', url: 'https://stemfra.com/faq' }];
const IGNORE = 'If you didn’t request this, you can safely ignore this email — nothing will change.';
const ACTION = '{{ .ConfirmationURL }}';

function confirmSignup() {
  return {
    subject: 'Confirm your email',
    html: renderEmail({
      heading: 'Confirm your email',
      preheader: 'Confirm your email to finish setting up your account.',
      paragraphs: ['Welcome to Stemfra! Confirm your email address to activate your account.'],
      cta: { label: 'Confirm email', url: ACTION },
      note: 'This link expires in 24 hours. ' + IGNORE,
      footerLinks: HELP,
    }),
  };
}

function magicLink() {
  return {
    subject: 'Your sign-in link',
    html: renderEmail({
      heading: 'Sign in to your account',
      preheader: 'Your one-time sign-in link.',
      paragraphs: ['Use the button below to sign in. This link works once and expires shortly.'],
      cta: { label: 'Sign in', url: ACTION },
      note: IGNORE,
      footerLinks: HELP,
    }),
  };
}

function resetPassword() {
  return {
    subject: 'Reset your password',
    html: renderEmail({
      heading: 'Reset your password',
      preheader: 'Reset the password for your account.',
      paragraphs: ['We received a request to reset your password. Choose a new one with the button below.'],
      cta: { label: 'Reset password', url: ACTION },
      note: 'This link expires in 1 hour. ' + IGNORE,
      security: 'For your security, never share this link with anyone.',
      footerLinks: HELP,
    }),
  };
}

function changeEmail() {
  return {
    subject: 'Confirm your new email address',
    html: renderEmail({
      heading: 'Confirm your new email',
      preheader: 'Confirm the new email address on your account.',
      paragraphs: ['Confirm this address to finish changing the email on your account.'],
      cta: { label: 'Confirm new email', url: ACTION },
      note: IGNORE,
      footerLinks: HELP,
    }),
  };
}

const ALL = { confirmSignup, magicLink, resetPassword, changeEmail };
module.exports = ALL;
