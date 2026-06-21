// CMS — manage native membership plans (System B). A plan is a site_products row
// with product_type='membership'. For native plans we create a Stripe Product +
// recurring Price on the PLATFORM account (subscriptions are created there with
// transfer_data to the gym). External (bring-your-own) plans just store a link.
// Single-var supabase require per convention.
const supabase = require('../../config/supabase');
const { stripe } = require('../../config/stripe');
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
    let stripeProductId = null;
    let stripePriceId = null;

    if (fulfillmentMode === 'native') {
      if (!priceCents || priceCents <= 0) return res.status(400).json({ success: false, message: 'Native plans need a price.' });
      if (!stripe) return res.status(503).json({ success: false, message: 'Stripe not configured.' });
      const product = await stripe.products.create({
        name: displayName,
        metadata: { site_id: siteId, kind: 'site_membership' },
      });
      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: priceCents,
        currency: currency.toLowerCase(),
        recurring: { interval, interval_count: intervalCount },
      });
      stripeProductId = product.id;
      stripePriceId = price.id;
    }

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
      external_url: externalUrl || null,
      photo_url: photoUrl || null,
      slug: slugify(displayName),
      display_order: displayOrder,
      is_active: true,
      stripe_product_id: stripeProductId,
      stripe_price_id: stripePriceId,
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

// Update a plan. Price changes create a NEW Stripe Price (Prices are immutable);
// existing subscribers keep their current price — only new sign-ups get the new
// one. Other fields update in place.
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
    if (externalUrl !== undefined) patch.external_url = externalUrl || null;

    if (priceCents !== undefined && priceCents > 0 && priceCents !== plan.price_cents && plan.fulfillment_mode === 'native') {
      if (!stripe) return res.status(503).json({ success: false, message: 'Stripe not configured.' });
      let productId = plan.stripe_product_id;
      if (!productId) {
        const product = await stripe.products.create({ name: plan.name?.en || 'Membership', metadata: { site_id: plan.site_id, kind: 'site_membership' } });
        productId = product.id;
        patch.stripe_product_id = productId;
      }
      const price = await stripe.prices.create({
        product: productId,
        unit_amount: priceCents,
        currency: plan.currency || 'usd',
        recurring: { interval: plan.billing_interval || 'month', interval_count: plan.billing_interval_count || 1 },
      });
      patch.stripe_price_id = price.id;
      patch.price_cents = priceCents;
    } else if (priceCents !== undefined && plan.fulfillment_mode !== 'native') {
      patch.price_cents = priceCents; // external: display price only
    }

    const { data, error } = await supabase.from('site_products').update(patch).eq('id', id).select().single();
    if (error) return res.status(500).json({ success: false, message: error.message });
    res.json({ success: true, plan: data });
  } catch (err) {
    console.error('[membershipPlans.updatePlan]', err.message);
    res.status(500).json({ success: false, message: 'Could not update plan.' });
  }
}

// Soft-delete: archive the Stripe product + deactivate the row (existing
// subscriptions keep working; the plan just stops being offered).
async function deletePlan(req, res) {
  try {
    const { id } = req.params;
    const { data: plan } = await supabase
      .from('site_products').select('id, site_id, stripe_product_id').eq('id', id).single();
    if (!plan) return res.status(404).json({ success: false, message: 'Plan not found.' });
    const site = await verifySiteOwnership(req.cmsUser.id, plan.site_id);
    if (!site) return res.status(403).json({ success: false, message: 'Not your site.' });
    if (plan.stripe_product_id && stripe) {
      try { await stripe.products.update(plan.stripe_product_id, { active: false }); } catch { /* best effort */ }
    }
    await supabase.from('site_products').update({ is_active: false }).eq('id', id);
    res.json({ success: true });
  } catch (err) {
    console.error('[membershipPlans.deletePlan]', err.message);
    res.status(500).json({ success: false, message: 'Could not delete plan.' });
  }
}

module.exports = { listPlans, createPlan, updatePlan, deletePlan };
