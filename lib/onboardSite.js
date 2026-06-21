// Customer onboarding (Phase 2f). Server-mediated signup: create the Supabase
// auth user + the business company + the owner contact (linked to the auth
// user), then provision a previewing site by cloning the vertical seed. One
// transaction-ish flow with rollback so a partial signup leaves nothing behind.
// Free at this stage (preview-then-publish); payment happens at publish.
const supabase = require('../config/supabase');
const { provisionSite, deleteSiteCascade } = require('./provisionSite');

const tagged = (code, msg) => Object.assign(new Error(msg), { code });

/**
 * @param {object} a { name, email, password, company, vertical, city?, templateSlug? }
 * @returns {Promise<{ authUserId, companyId, contactId, site }>}
 * @throws Error .code: 'bad_input' | 'weak_password' | 'email_taken'
 */
async function onboardCustomer({ name, email, password, company, vertical, city = null, templateSlug = null }) {
  if (!email || !password || !company || !vertical) {
    throw tagged('bad_input', 'name, email, password, company and vertical are required.');
  }
  if (String(password).length < 8) throw tagged('weak_password', 'Password must be at least 8 characters.');

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
      .insert({ full_name: name || company, email, company_id: companyId, auth_user_id: authUserId })
      .select('id')
      .single();
    if (ctErr) throw new Error(`contact: ${ctErr.message}`);
    contactId = ct.id;

    // 4) Provision the previewing site (seed clone).
    site = await provisionSite({
      vertical, companyId, ownerContactId: contactId,
      displayName: company, city, templateSlug, createdBy: authUserId,
    });
  } catch (err) {
    // Roll back everything so a failed signup leaves no orphans.
    try { if (site?.siteId) await deleteSiteCascade(site.siteId); } catch { /* best-effort */ }
    try { if (contactId) await supabase.from('contacts').delete().eq('id', contactId); } catch { /* best-effort */ }
    try { if (companyId) await supabase.from('companies').delete().eq('id', companyId); } catch { /* best-effort */ }
    try { await supabase.auth.admin.deleteUser(authUserId); } catch { /* best-effort */ }
    throw err;
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
