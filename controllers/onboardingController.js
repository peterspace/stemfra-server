// Public onboarding endpoint (Phase 2f). Called by stemfra_client's signup/buy
// form. Creates the account + provisions a previewing site, then the client
// redirects the owner to the CMS to log in and customize. Free at this stage
// (preview-then-publish); abuse is bounded by a light per-IP rate limit + the
// fact that a previewing site can't be published without paying.
const { onboardCustomer } = require('../lib/onboardSite');

const CMS_URL = process.env.CMS_URL || 'http://localhost:5180';
const ZONE = 'stemfra.com';

// Light in-memory per-IP rate limit (v1). Production should use a shared store.
const hits = new Map();
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 6;
function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > MAX_PER_WINDOW;
}

async function signup(req, res) {
  try {
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || 'unknown';
    if (rateLimited(ip)) return res.status(429).json({ error: 'Too many signups from here — please try again later.' });

    const {
      name, email, password, company, vertical, starterId, city, template,
      firstName, lastName, country, state, bookingProvider, bookingUrl, paymentMethods, tier, goals,
    } = req.body || {};
    const result = await onboardCustomer({
      name, email, password, company, vertical: vertical || null, starterId: starterId || null,
      city: city || null, templateSlug: template || null,
      firstName: firstName || null, lastName: lastName || null,
      country: country || null, state: state || null,
      bookingProvider: bookingProvider || null, bookingUrl: bookingUrl || null,
      paymentMethods: paymentMethods || null, tier: tier || null,
      goals: Array.isArray(goals) ? goals : null,
    });

    res.json({
      ok: true,
      siteId: result.site.siteId,
      subdomain: result.site.subdomain,
      previewUrl: `https://${result.site.subdomain}.${ZONE}`,
      loginUrl: CMS_URL,
    });
  } catch (err) {
    const statusByCode = { bad_input: 400, weak_password: 400, email_taken: 409 };
    if (statusByCode[err.code]) return res.status(statusByCode[err.code]).json({ error: err.message, code: err.code });
    console.error('[onboarding.signup]', err.message);
    res.status(500).json({ error: 'Could not complete signup. Please try again.' });
  }
}

module.exports = { signup };
