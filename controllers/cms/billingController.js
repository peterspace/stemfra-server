// CMS client-facing billing (System A) — the OWNER sees their own Stemfra
// subscription + charge history and edits their billing contact. Read-only on
// the money; the staff CRM drives collection. Owner-auth + ownership-gated.
// NOTE: config/supabase.js exports the client directly (service-role).
const supabase = require('../../config/supabase');
const { verifySiteOwnership, resolveContactId } = require('../../middleware/cmsAuth');

// GET /api/cms/billing?siteId= — subscription + charges + billing contact
async function getBilling(req, res) {
  const siteId = req.query.siteId;
  if (!siteId) return res.status(400).json({ error: 'siteId is required' });
  const site = await verifySiteOwnership(req.cmsUser.id, siteId);
  if (!site) return res.status(403).json({ error: 'Not your site' });

  const { data: sub } = await supabase.from('subscriptions')
    .select('id, status, provider, build_amount_cents, monthly_amount_cents, currency, started_at, metadata')
    .eq('site_id', siteId).maybeSingle();

  let charges = [];
  if (sub) {
    const { data } = await supabase.from('billing_charges')
      .select('id, kind, line_items, amount_cents, currency, status, due_date, paid_at, created_at')
      .eq('subscription_id', sub.id).order('created_at', { ascending: false });
    charges = data || [];
  }

  const contactId = await resolveContactId(req.cmsUser.id);
  let contact = null;
  if (contactId) {
    const { data } = await supabase.from('contacts')
      .select('full_name, first_name, last_name, email, country, state').eq('id', contactId).maybeSingle();
    contact = data || null;
  }
  return res.json({ subscription: sub || null, charges, contact });
}

// PATCH /api/cms/billing/contact { first_name?, last_name?, country?, state? }
// The owner provides the billing details we need for the Payoneer request.
async function updateBillingContact(req, res) {
  const contactId = await resolveContactId(req.cmsUser.id);
  if (!contactId) return res.status(404).json({ error: 'No contact for this account' });
  const { first_name, last_name, country, state } = req.body || {};
  const patch = {};
  if (first_name !== undefined) patch.first_name = first_name;
  if (last_name !== undefined) patch.last_name = last_name;
  if (country !== undefined) patch.country = country;
  if (state !== undefined) patch.state = state;
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to update' });
  const { data, error } = await supabase.from('contacts').update(patch).eq('id', contactId)
    .select('full_name, first_name, last_name, email, country, state').single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ contact: data });
}

module.exports = { getBilling, updateBillingContact };
