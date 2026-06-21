// Shared System A (platform billing) checkout creation — used by the staff
// endpoint (controllers/platformBillingController) AND the owner-facing
// pay-to-publish endpoint (controllers/cms/publishController). Stemfra is the
// merchant on its OWN Stripe account (no Connect); the business is the customer.
// Charges the monthly hosting fee (recurring) + the one-time build fee (lands on
// the first invoice in subscription mode); upserts the `subscriptions` row at
// status 'pending' (the webhook flips it to 'active' on checkout.completed).
const supabase = require('../config/supabase');
const { stripe } = require('../config/stripe');

/**
 * @returns {Promise<{url, sessionId, customerId}>}
 * @throws Error with .code 'no_stripe' | 'not_found' | 'no_email'
 */
async function createPlatformCheckout({ siteId, monthlyAmountCents, buildAmountCents = 0, currency = 'usd', successUrl, cancelUrl }) {
  if (!stripe) { const e = new Error('Stripe not configured.'); e.code = 'no_stripe'; throw e; }
  if (!siteId || !monthlyAmountCents || monthlyAmountCents <= 0) {
    const e = new Error('Missing siteId or monthlyAmountCents.'); e.code = 'bad_input'; throw e;
  }

  const { data: site } = await supabase
    .from('sites').select('id, company_id, owner_contact_id, subdomain').eq('id', siteId).single();
  if (!site) { const e = new Error('Site not found.'); e.code = 'not_found'; throw e; }

  const [{ data: company }, { data: contact }] = await Promise.all([
    site.company_id ? supabase.from('companies').select('name').eq('id', site.company_id).single() : Promise.resolve({ data: null }),
    site.owner_contact_id ? supabase.from('contacts').select('email, full_name').eq('id', site.owner_contact_id).single() : Promise.resolve({ data: null }),
  ]);
  const email = contact?.email;
  if (!email) { const e = new Error('No billing email on the owner contact.'); e.code = 'no_email'; throw e; }
  const businessName = company?.name || contact?.full_name || site.subdomain;
  const cur = currency.toLowerCase();

  const { data: existing } = await supabase
    .from('subscriptions').select('id, stripe_customer_id, deal_id').eq('site_id', siteId).maybeSingle();

  let customerId = existing?.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email, name: businessName, metadata: { site_id: siteId, kind: 'platform_billing' },
    });
    customerId = customer.id;
  }

  const lineItems = [{
    price_data: {
      currency: cur,
      product_data: { name: `${businessName} — Stemfra hosting & maintenance` },
      unit_amount: monthlyAmountCents,
      recurring: { interval: 'month' },
    },
    quantity: 1,
  }];
  if (buildAmountCents > 0) {
    lineItems.push({
      price_data: { currency: cur, product_data: { name: 'Stemfra website build (one-time)' }, unit_amount: buildAmountCents },
      quantity: 1,
    });
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: lineItems,
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { site_id: siteId, kind: 'platform_billing' },
    subscription_data: { metadata: { site_id: siteId, kind: 'platform_billing' } },
  });

  const row = {
    site_id: siteId,
    deal_id: existing?.deal_id ?? null,
    build_amount_cents: buildAmountCents,
    monthly_amount_cents: monthlyAmountCents,
    currency: cur,
    stripe_customer_id: customerId,
    status: 'pending',
  };
  if (existing?.id) await supabase.from('subscriptions').update(row).eq('id', existing.id);
  else await supabase.from('subscriptions').insert(row);

  return { url: session.url, sessionId: session.id, customerId };
}

module.exports = { createPlatformCheckout };
