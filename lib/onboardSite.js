// Customer onboarding (Phase 2f). Server-mediated signup: create the Supabase
// auth user + the business company + the owner contact (linked to the auth
// user), then provision a previewing site by cloning the vertical seed. One
// transaction-ish flow with rollback so a partial signup leaves nothing behind.
// Free at this stage (preview-then-publish); payment happens at publish.
const supabase = require('../config/supabase');
const { provisionSite, cloneSite, deleteSiteCascade } = require('./provisionSite');
const { getApprovedStarter } = require('./starters');

const tagged = (code, msg) => Object.assign(new Error(msg), { code });

// The commission rate + policy version the owner agrees to at signup (mirrors the
// marketing /fees page + the CMS signup summary). Stamped into the acceptance
// record so we know exactly what was agreed, even if the rate changes later.
const FEES_COMMISSION_PCT = 5;
// Versions come from the ONE legal registry (lib/legalDocs.js) so the fees
// stamp on the site + the acceptance ledger can never disagree.
const { LEGAL_DOCS, recordLegalAcceptance } = require('./legalDocs');
const { isTestEmail } = require('./testData');
const FEES_POLICY_VERSION = LEGAL_DOCS.fees.version;

/**
 * @param {object} a { name, email, password, company, vertical?, starterId?, city?, templateSlug? }
 * @returns {Promise<{ authUserId, companyId, contactId, site }>}
 * @throws Error .code: 'bad_input' | 'weak_password' | 'email_taken'
 *
 * If `starterId` is a flagged, approved Starter, the site is provisioned by
 * CLONING that Starter (exact design + palette + arrangement + content the
 * prospect previewed). Otherwise it clones the vertical seed (needs `vertical`).
 */
async function onboardCustomer({
  name, email, password, company, vertical = null, starterId = null, cloneSourceId = null,
  city = null, templateSlug = null,
  // KYC/KYB + the two onboarding questions (all optional, additive).
  firstName = null, lastName = null, country = null, state = null,
  bookingProvider = null, paymentMethods = null, tier = null, goals = null, hasStripe = null,
  feesAccepted = false, hasDomain = false, domain = null,
  // Legal acceptance (launch task #5): PUBLIC signup must tick the combined
  // Terms + Privacy + Fees consent (`termsAccepted`); staff-created accounts
  // (admin clone / CRM onboarding) pass `requireTerms:false` and accept at first
  // CMS login instead (follow-up). `clientIp`/`userAgent` are stored as evidence.
  termsAccepted = false, requireTerms = false, clientIp = null, userAgent = null,
}) {
  if (requireTerms && !termsAccepted) {
    throw tagged('terms_required', 'Please accept the Terms of Service, Privacy Policy and Fees & Payments Policy to continue.');
  }
  if (!email || !password || !company || (!vertical && !starterId && !cloneSourceId)) {
    throw tagged('bad_input', 'email, password, company and (vertical, starterId or cloneSourceId) are required.');
  }
  // Resolve the clone source up front (fail before creating the auth user).
  //  - starterId: PUBLIC path → whitelist-guarded (only approved sample sites).
  //  - cloneSourceId: STAFF path (the admin route is staff-gated) → any site;
  //    existence-checked only. Never expose cloneSourceId on a public endpoint.
  let cloneFromId = null;
  if (cloneSourceId) {
    const { data: src, error } = await supabase.from('sites').select('id').eq('id', cloneSourceId).maybeSingle();
    if (error) throw new Error(`clone source lookup: ${error.message}`);
    if (!src) throw tagged('bad_input', 'Source site not found.');
    cloneFromId = cloneSourceId;
  } else if (starterId) {
    const starter = await getApprovedStarter(starterId);
    if (!starter) throw tagged('bad_input', 'That starting design is not available.');
    cloneFromId = starter.id;
  }
  if (String(password).length < 8) throw tagged('weak_password', 'Password must be at least 8 characters.');

  // Capture first/last directly (KYC). Fall back to splitting a single `name`.
  const fn = firstName || (name ? name.trim().split(/\s+/)[0] : null);
  const ln = lastName || (name ? (name.trim().split(/\s+/).slice(1).join(' ') || null) : null);

  // 1) Auth user (auto-confirmed so they can sign into the CMS immediately).
  const { data: created, error: cErr } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: name || null, company },
  });
  if (cErr) {
    if (/already|registered|exists/i.test(cErr.message)) {
      throw tagged('email_taken', 'That email already has an account — please log in instead.');
    }
    throw new Error(`create user: ${cErr.message}`);
  }
  const authUserId = created.user.id;

  let companyId;
  let contactId;
  let site;
  try {
    // 2) Company (the business).
    const { data: co, error: coErr } = await supabase.from('companies').insert({ name: company }).select('id').single();
    if (coErr) throw new Error(`company: ${coErr.message}`);
    companyId = co.id;

    // 3) Owner contact, linked to the auth user (the CMS login bridge).
    const { data: ct, error: ctErr } = await supabase
      .from('contacts')
      .insert({ full_name: name || company, first_name: fn, last_name: ln, country, state, email, company_id: companyId, auth_user_id: authUserId })
      .select('id')
      .single();
    if (ctErr) throw new Error(`contact: ${ctErr.message}`);
    contactId = ct.id;

    // 4) Provision the previewing site. A Starter → clone it EXACTLY (design +
    //    palette + arrangement + content the prospect previewed); otherwise clone
    //    the vertical seed onto the template default.
    //    No createdBy: self-serve signup has no STAFF actor, and sites.created_by
    //    FKs profiles (staff) — passing the client's auth id violates the FK.
    site = cloneFromId
      ? await cloneSite({
          sourceSiteId: cloneFromId, companyId, ownerContactId: contactId,
          displayName: company, city, status: 'previewing',
        })
      : await provisionSite({
          vertical, companyId, ownerContactId: contactId,
          displayName: company, city, templateSlug,
        });

    // 5) Apply the onboarding answers to the site (booking choice + a staff-visible
    //    record of how they take payment + which tier they picked).
    const patch = {};
    // Booking is Stemfra-native by default; the only non-native option is
    // "no online booking" (consultation_form). External link-out to
    // Mindbody/Vagaro/etc. was removed 2026-07-29.
    if (bookingProvider === 'none') { patch.booking_mode = 'consultation_form'; patch.booking_config = {}; }
    // Fees & Payments Policy acceptance. The client only sends the boolean tick;
    // the SERVER stamps the timestamp (never trust the client for the time of a
    // legal record), plus the commission rate + policy version the owner agreed to.
    const feesPolicy = feesAccepted
      ? { accepted: true, accepted_at: new Date().toISOString(), commission_percent: FEES_COMMISSION_PCT, policy_version: FEES_POLICY_VERSION, source: 'signup' }
      : null;
    // Task 57 (domain policy): record the "do you already have a domain?" answer.
    // Normalized capture only — the actual connect happens post-signup via the
    // CMS Settings → Domain card (or staff). A malformed entry is stored raw-ish
    // but never breaks signup.
    const cleanedDomain = (domain || '')
      .trim().toLowerCase()
      .replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
    const domainAnswer = (hasDomain || cleanedDomain)
      ? { has_domain: !!hasDomain, domain: cleanedDomain || null }
      : null;
    // Test/demo isolation (launch task #9): a signup from a test email domain
    // (TEST_EMAIL_DOMAINS, default stemfra.com/example.com) is a TEST tenant:
    // excluded from invoices, sweepers, compliance and KPIs, purgeable later.
    const testTenant = isTestEmail(email);
    if (tier || paymentMethods || bookingProvider || feesPolicy || domainAnswer || hasStripe || testTenant) {
      const { data: cur } = await supabase.from('sites').select('metadata').eq('id', site.siteId).single();
      patch.metadata = {
        ...(cur?.metadata || {}),
        ...(testTenant ? { is_test: true } : {}),
        onboarding: {
          tier: tier || null,
          payment_methods: paymentMethods || null,
          booking_provider: bookingProvider || 'stemfra',
          ...(feesPolicy ? { fees_policy: feesPolicy } : {}),
          ...(domainAnswer ? { domain: domainAnswer } : {}),
          // "Do you have a Stripe account?" (2026-08-04) — staff-facing, mirrors
          // the domain answer: tells the setup call where to start. Never gates
          // anything; 'unsure' is a fine answer.
          ...(hasStripe ? { stripe: { has_account: hasStripe } } : {}),
        },
      };
    }
    if (Object.keys(patch).length) await supabase.from('sites').update(patch).eq('id', site.siteId);

    // Goals (what they said they want to do) live on site_theme_settings.metadata
    // so Stacy's onboarding checklist can prioritize the matching setup steps.
    if (Array.isArray(goals) && goals.length) {
      const { data: ts } = await supabase.from('site_theme_settings').select('site_id, metadata').eq('site_id', site.siteId).maybeSingle();
      const meta = (ts && ts.metadata && typeof ts.metadata === 'object') ? { ...ts.metadata } : {};
      meta.goals = goals;
      if (ts) await supabase.from('site_theme_settings').update({ metadata: meta }).eq('site_id', site.siteId);
      else await supabase.from('site_theme_settings').insert({ site_id: site.siteId, metadata: meta });
    }
  } catch (err) {
    // Roll back everything so a failed signup leaves no orphans.
    try { if (site?.siteId) await deleteSiteCascade(site.siteId); } catch { /* best-effort */ }
    try { if (contactId) await supabase.from('contacts').delete().eq('id', contactId); } catch { /* best-effort */ }
    try { if (companyId) await supabase.from('companies').delete().eq('id', companyId); } catch { /* best-effort */ }
    try { await supabase.auth.admin.deleteUser(authUserId); } catch { /* best-effort */ }
    throw err;
  }

  // Legal ledger (after the account + site exist; best-effort, loudly logged).
  if (termsAccepted || feesAccepted) {
    const docs = termsAccepted ? ['terms', 'privacy', 'fees'] : ['fees'];
    await recordLegalAcceptance({
      contactId, authUserId, email, siteId: site.siteId, docs, source: 'signup',
      ip: clientIp, userAgent, metadata: { commission_percent: FEES_COMMISSION_PCT },
    });
  }

  return { authUserId, companyId, contactId, site };
}

/** Tear down an onboarded customer by email (test cleanup). */
async function offboardByEmail(email) {
  const { data: contact } = await supabase
    .from('contacts').select('id, company_id, auth_user_id').eq('email', email).maybeSingle();
  if (!contact) return { removed: false };
  const { data: sites } = await supabase.from('sites').select('id').eq('owner_contact_id', contact.id);
  for (const s of sites || []) await deleteSiteCascade(s.id);
  await supabase.from('contacts').delete().eq('id', contact.id);
  if (contact.company_id) await supabase.from('companies').delete().eq('id', contact.company_id);
  if (contact.auth_user_id) { try { await supabase.auth.admin.deleteUser(contact.auth_user_id); } catch { /* best-effort */ } }
  return { removed: true, sites: (sites || []).length };
}

module.exports = { onboardCustomer, offboardByEmail };
