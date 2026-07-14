// One-click CMS access for owner-facing emails (N2, 2026-07-13).
//
// Turns a CMS deep link (e.g. /bookings) into a Supabase MAGIC LINK so a site
// owner who clicks a notification email lands in the CMS already signed in — no
// password re-entry. Uses Supabase's built-in generateLink: the token is
// SINGLE-USE and short-lived (the project's OTP expiry, ~1h), the same
// mechanism password resets use. If generation fails (or the link later expires
// or is reused), the caller falls back to the plain CMS URL and the owner just
// logs in normally — never a lockout.
//
// Reusable for any owner-facing email (bookings, leads, Stacy handoff …). NOT
// for customer emails — customers are not CMS users.
//
// ⚠️ For the redirect to land on the deep link, the CMS origin must be in the
// Supabase Auth "Redirect URLs" allowlist: https://cms.stemfra.com/** (prod) and
// http://localhost:5180/** (dev). Otherwise Supabase redirects to the Site URL.
const supabase = require('../config/supabase');

const CMS_URL = process.env.CMS_PUBLIC_URL || 'https://cms.stemfra.com';

// Build a one-click magic link to `${CMS}${path}` for the given auth user.
// Returns the action_link on success, or null (caller uses the plain URL).
async function cmsMagicLink(authUserId, path = '/') {
  if (!authUserId) return null;
  try {
    // The magic link must target the user's REAL auth email, not a contact
    // email that might differ — resolve it from the auth user id.
    const { data: u, error: uErr } = await supabase.auth.admin.getUserById(authUserId);
    const email = u?.user?.email;
    if (uErr || !email) return null;

    const redirectTo = `${CMS_URL}${path.startsWith('/') ? path : `/${path}`}`;
    const { data, error } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: { redirectTo },
    });
    if (error) { console.error('[cmsMagicLink]', error.message); return null; }
    return data?.properties?.action_link || null;
  } catch (e) {
    console.error('[cmsMagicLink]', e.message);
    return null;
  }
}

module.exports = { cmsMagicLink, CMS_URL };
