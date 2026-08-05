// CMS — manage membership plans. A plan is a site_products row with
// product_type='membership'. P14 (pay-at-venue, 2026-08-05): plans are PLAIN DB
// ROWS — no Stripe Product/Price is created (online payments are suspended;
// members sign up and pay at the venue). Any stripe_product_id/stripe_price_id
// on legacy rows is left untouched (display-inert). Single-var supabase require.
const supabase = require('../../config/supabase');
const { verifySiteOwnership } = require('../../middleware/cmsAuth');

function slugify(s) {
  const base = String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'plan';
  // short suffix keeps it unique per site without a lookup
  return `${base}-${Math.random().toString(36).slice(2, 6)}`;
}

async function listPlans(req, res) {
  const siteId = req.query.siteId;
  if (!siteId) return res.status(400).json({ success: false, message: 'Missing siteId.' });
  const site = await verifySiteOwnership(req.cmsUser.id, siteId);
  if (!site) return res.status(403).json({ success: false, message: 'Not your site.' });
  const { data, error } = await supabase
    .from('site_products').select('*')
    .eq('site_id', siteId).eq('product_type', 'membership')
    .order('display_order', { ascending: true });
  if (error) return res.status(500).json({ success: false, message: error.message });
  res.json({ success: true, plans: data || [] });
}

async function createPlan(req, res) {
  try {
    const {
      siteId, name, description, priceCents, currency = 'usd',
      interval = 'month', intervalCount = 1, fulfillmentMode = 'native',
      externalUrl, photoUrl, features, displayOrder = 0,
    } = req.body || {};
    if (!siteId || !name) return res.status(400).json({ success: false, message: 'Missing siteId or name.' });
    const site = await verifySiteOwnership(req.cmsUser.id, siteId);
    if (!site) return res.status(403).json({ success: false, message: 'Not your site.' });

    const displayName = typeof name === 'string' ? name : name.en;
    if (!priceCents || priceCents <= 0) return res.status(400).json({ success: false, message: 'A plan needs a price.' });

    const row = {
      site_id: siteId,
      product_type: 'membership',
      name: typeof name === 'string' ? { en: name } : name,
      description: description ? (typeof description === 'string' ? { en: description } : description) : null,
      price_cents: priceCents || 0,
      currency: currency.toLowerCase(),
      billing_interval: interval,
      billing_interval_count: intervalCount,
      fulfillment_mode: fulfillmentMode,
      external_url: null,   // native booking only (2026-07-31)
      photo_url: photoUrl || null,
      slug: slugify(displayName),
      display_order: displayOrder,
      is_active: true,
      stripe_product_id: null, // pay-at-venue: no Stripe object
      stripe_price_id: null,
      metadata: features ? { features } : {},
    };
    const { data, error } = await supabase.from('site_products').insert(row).select().single();
    if (error) return res.status(500).json({ success: false, message: error.message });
    res.json({ success: true, plan: data });
  } catch (err) {
    console.error('[membershipPlans.createPlan]', err.message);
    res.status(500).json({ success: false, message: 'Could not create plan.' });
  }
}

// Update a plan (plain DB row). Price changes patch price_cents in place; a
// member's amount is captured on their subscription at signup, so existing
// members keep their rate and only new sign-ups get the new price.
async function updatePlan(req, res) {
  try {
    const { id } = req.params;
    const { name, description, photoUrl, features, displayOrder, isActive, priceCents, externalUrl } = req.body || {};
    const { data: plan } = await supabase.from('site_products').select('*').eq('id', id).single();
    if (!plan) return res.status(404).json({ success: false, message: 'Plan not found.' });
    const site = await verifySiteOwnership(req.cmsUser.id, plan.site_id);
    if (!site) return res.status(403).json({ success: false, message: 'Not your site.' });

    const patch = {};
    if (name !== undefined) patch.name = typeof name === 'string' ? { en: name } : name;
    if (description !== undefined) patch.description = description ? (typeof description === 'string' ? { en: description } : description) : null;
    if (photoUrl !== undefined) patch.photo_url = photoUrl || null;
    if (features !== undefined) patch.metadata = { ...(plan.metadata || {}), features };
    if (displayOrder !== undefined) patch.display_order = displayOrder;
    if (isActive !== undefined) patch.is_active = isActive;
    // external_url is deliberately NOT patchable: native booking only (2026-07-31).

    if (priceCents !== undefined && priceCents > 0) patch.price_cents = priceCents;

    const { data, error } = await supabase.from('site_products').update(patch).eq('id', id).select().single();
    if (error) return res.status(500).json({ success: false, message: error.message });
    res.json({ success: true, plan: data });
  } catch (err) {
    console.error('[membershipPlans.updatePlan]', err.message);
    res.status(500).json({ success: false, message: 'Could not update plan.' });
  }
}

// Soft-delete: deactivate the row (existing subscriptions keep working; the plan
// just stops being offered). No Stripe object to archive under pay-at-venue.
async function deletePlan(req, res) {
  try {
    const { id } = req.params;
    const { data: plan } = await supabase
      .from('site_products').select('id, site_id').eq('id', id).single();
    if (!plan) return res.status(404).json({ success: false, message: 'Plan not found.' });
    const site = await verifySiteOwnership(req.cmsUser.id, plan.site_id);
    if (!site) return res.status(403).json({ success: false, message: 'Not your site.' });
    await supabase.from('site_products').update({ is_active: false }).eq('id', id);
    res.json({ success: true });
  } catch (err) {
    console.error('[membershipPlans.deletePlan]', err.message);
    res.status(500).json({ success: false, message: 'Could not delete plan.' });
  }
}

module.exports = { listPlans, createPlan, updatePlan, deletePlan };
