// Domain renewal sweeper (2026-08-10, Peter's Manage arc). Once a day it looks
// at every Stemfra-registered domain approaching expiry and:
//
//   AUTO-RENEW ON  → T-30: open the renewal invoice at RENEWAL retail
//                    (billing_charges kind='adjustment', metadata
//                    type='domain_renewal') + email it (bank transfer, like
//                    every invoice). T-7 with the invoice still unpaid → a
//                    payment reminder (dunning email) + a staff alert.
//                    Porkbun itself performs the renewal from the prepaid
//                    balance at expiry — our job is collecting from the tenant.
//   AUTO-RENEW OFF → T-30 and T-7 "your domain will expire" notices, then the
//                    domain lapses at term end (expiry with auto-renew off IS
//                    cancellation — registrars have no delete).
//
// Per-cycle send-once stamps live at sites.metadata.domain_renewal[expireDate]
// so reruns never double-send. Idempotent; every step best-effort; INERT until
// a managed domain is within 35 days of expiry (argyleandsons.click: 2027).
// Disable with DOMAIN_RENEWAL_SWEEPER_ENABLED=false.
const supabase = require('../config/supabase');
const registrar = require('./registrar');
const billing = require('./billing');
const { sendMail } = require('./mailer');
const { sendDunningEmail } = require('./billingEmails');
const { logSiteActivity } = require('./activity');

const ENABLED = process.env.DOMAIN_RENEWAL_SWEEPER_ENABLED !== 'false';
const SWEEP_EVERY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 35;

const daysUntil = (dateStr) => Math.floor((new Date(dateStr).getTime() - Date.now()) / 86400000);
const dueInDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

async function renewalRetailCents(reg, domain) {
  const tld = domain.split('.').slice(1).join('.');
  const p = (await reg.getPricing())[tld]?.renewal;
  return p != null ? reg.retailCents(Math.round(Number(p) * 100)) : null;
}

async function ownerEmailFor(siteId) {
  const { data } = await supabase.from('sites')
    .select('subdomain, company:companies(name), owner:contacts!sites_owner_contact_id_fkey(email, first_name)')
    .eq('id', siteId).maybeSingle();
  return {
    email: data?.owner?.email || null,
    firstName: data?.owner?.first_name || null,
    business: data?.company?.name || data?.subdomain || 'your business',
  };
}

// Read/patch the per-cycle stamps on sites.metadata.domain_renewal.
async function getStamps(siteId, cycleKey) {
  const { data } = await supabase.from('sites').select('metadata').eq('id', siteId).maybeSingle();
  return { meta: data?.metadata || {}, stamps: data?.metadata?.domain_renewal?.[cycleKey] || {} };
}
async function setStamp(siteId, cycleKey, patch) {
  const { meta, stamps } = await getStamps(siteId, cycleKey);
  const next = { ...meta, domain_renewal: { ...(meta.domain_renewal || {}), [cycleKey]: { ...stamps, ...patch } } };
  await supabase.from('sites').update({ metadata: next }).eq('id', siteId);
}

async function existingRenewalCharge(siteId, domain, cycleKey) {
  const { data } = await supabase.from('billing_charges')
    .select('id, status')
    .eq('site_id', siteId)
    .contains('metadata', { type: 'domain_renewal', domain, expire_date: cycleKey })
    .maybeSingle();
  return data || null;
}

async function openRenewalInvoice({ siteId, domain, expireDate, retailCents }) {
  const { data: sub } = await supabase.from('subscriptions').select('id, currency').eq('site_id', siteId).maybeSingle();
  const { data: ch, error } = await supabase.from('billing_charges').insert({
    subscription_id: sub?.id ?? null, site_id: siteId, kind: 'adjustment',
    line_items: [{ label: `Domain renewal — ${domain} (1 yr)`, cents: retailCents }],
    amount_cents: retailCents, currency: sub?.currency || 'USD',
    due_date: dueInDays(Math.max(7, Math.min(14, daysUntil(expireDate) - 3))),
    status: 'due', provider: 'airwallex',
    metadata: { type: 'domain_renewal', domain, expire_date: expireDate },
  }).select('id').single();
  if (error) throw new Error(error.message);
  // markRequested emails the invoice (bank-transfer copy + PDF with bank panel).
  try { await billing.markRequested(ch.id, { by: null }); } catch { /* email best-effort */ }
  return ch.id;
}

async function sendExpiryNotice({ siteId, domain, expireDate, daysLeft }) {
  const owner = await ownerEmailFor(siteId);
  if (!owner.email) return false;
  return sendMail({
    fromName: 'Stemfra',
    to: owner.email,
    subject: `${domain} expires in ${daysLeft} days`,
    text: [
      `${owner.firstName ? `Hi ${owner.firstName},` : 'Hi,'}`,
      '',
      `Your domain ${domain} has renewal turned OFF and will expire on ${expireDate}.`,
      `After that date your website stops answering on ${domain} (your stemfra.com address keeps working), and the name becomes publicly available for anyone to register.`,
      '',
      'Want to keep it? Turn renewal back on under Settings, Domain in your dashboard, or just reply to this email.',
    ].join('\n'),
  });
}

/** One pass. Returns a report; { dryRun } inspects without writing/sending. */
async function sweepOnce({ dryRun = false } = {}) {
  const reg = registrar.active();
  if (!reg.isConfigured() || !reg.listDomains) return { skipped: 'registrar unconfigured' };

  const expiring = await reg.listDomains({ expiringWithinDays: WINDOW_DAYS });
  if (!expiring.length) return { checked: 0, actions: [] };

  // Map registrar domains to the tenant sites using them.
  const { data: sites } = await supabase.from('sites')
    .select('id, custom_domain')
    .in('custom_domain', expiring.map(d => d.domain));
  const siteByDomain = Object.fromEntries((sites || []).map(s => [s.custom_domain, s.id]));

  const actions = [];
  for (const d of expiring) {
    const siteId = siteByDomain[d.domain];
    if (!siteId || !d.expireDate) continue; // not a tenant domain (or no date) — staff watch these on the CRM page
    const daysLeft = daysUntil(d.expireDate);
    if (daysLeft < 0) continue;
    const cycleKey = d.expireDate;
    const { stamps } = await getStamps(siteId, cycleKey);

    try {
      if (d.autoRenew) {
        let charge = await existingRenewalCharge(siteId, d.domain, cycleKey);
        if (!charge && daysLeft <= 30) {
          const retail = await renewalRetailCents(reg, d.domain);
          if (retail == null) { actions.push({ domain: d.domain, action: 'no-pricing' }); continue; }
          if (!dryRun) {
            const chargeId = await openRenewalInvoice({ siteId, domain: d.domain, expireDate: d.expireDate, retailCents: retail });
            await setStamp(siteId, cycleKey, { invoice_id: chargeId, invoiced_at: new Date().toISOString() });
            logSiteActivity({ siteId, action: 'domain_renewal_invoiced', entityType: 'site', entityId: siteId, details: { domain: d.domain, expire_date: d.expireDate, retail_cents: retail, charge_id: chargeId } });
          }
          actions.push({ domain: d.domain, action: 'renewal-invoiced', daysLeft });
        } else if (charge && charge.status !== 'paid' && daysLeft <= 7 && !stamps.dunning7_at) {
          if (!dryRun) {
            await sendDunningEmail(charge.id).catch(() => {});
            await setStamp(siteId, cycleKey, { dunning7_at: new Date().toISOString() });
            const staffTo = process.env.NOTIFY_EMAIL || process.env.GMAIL_USER;
            if (staffTo) {
              sendMail({
                fromName: 'Stemfra Ops', to: staffTo,
                subject: `Domain renewal unpaid: ${d.domain} expires in ${daysLeft} days`,
                text: `${d.domain} auto-renews at Porkbun in ~${daysLeft} days but the tenant's renewal invoice is still unpaid. Review it on the CRM Billing page (charge ${charge.id}).`,
              }).catch(() => {});
            }
          }
          actions.push({ domain: d.domain, action: 'dunning-sent', daysLeft });
        }
      } else {
        // Auto-renew OFF: the tenant chose not to renew — notice at 30 and 7.
        if (daysLeft <= 30 && !stamps.notice30_at) {
          if (!dryRun) {
            await sendExpiryNotice({ siteId, domain: d.domain, expireDate: d.expireDate, daysLeft });
            await setStamp(siteId, cycleKey, { notice30_at: new Date().toISOString() });
          }
          actions.push({ domain: d.domain, action: 'expiry-notice-30', daysLeft });
        } else if (daysLeft <= 7 && !stamps.notice7_at) {
          if (!dryRun) {
            await sendExpiryNotice({ siteId, domain: d.domain, expireDate: d.expireDate, daysLeft });
            await setStamp(siteId, cycleKey, { notice7_at: new Date().toISOString() });
          }
          actions.push({ domain: d.domain, action: 'expiry-notice-7', daysLeft });
        }
      }
    } catch (e) {
      actions.push({ domain: d.domain, action: 'error', error: e.message });
    }
  }
  return { checked: expiring.length, actions };
}

function startDomainRenewalSweeper() {
  if (!ENABLED) { console.log('[domainRenewal] sweeper disabled'); return null; }
  const run = () => sweepOnce().then(r => {
    if (r.actions?.length) console.log('[domainRenewal]', JSON.stringify(r.actions));
  }).catch(e => console.error('[domainRenewal] sweep failed:', e.message));
  const t = setInterval(run, SWEEP_EVERY_MS);
  t.unref();
  setTimeout(run, 90 * 1000).unref(); // first pass shortly after boot
  return t;
}

module.exports = { sweepOnce, startDomainRenewalSweeper };
