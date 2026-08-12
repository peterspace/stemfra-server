// Billing Reconciliation Engine R1 (docs/RECONCILIATION.md, agreed 2026-08-11).
// Matches Airwallex deposits against unpaid billing_charges so invoices confirm
// themselves. Tiers: T1 reference match / T2 unique-amount → auto-pay (via the
// existing lib/billing markPaid choke point, so the receipt email + AWX mirror
// settle + pay-and-publish ride along); everything ambiguous → the CRM review
// queue (recon_deposits.status='review'); REVERSED deposits un-pay their charge.
// DRY-RUN mode records what WOULD happen (rows land as review/unmatched, nothing
// is marked paid) — the arming path is: dry-run → validate → flip dry_run off.
//
// recon_deposits is the dedup ledger: terminal statuses (matched/ignored/
// reversed) are never re-processed; pending/review/unmatched re-evaluate every
// sweep because the open-charge set changes.
const supabase = require('../config/supabase');
const { awx, isConfigured } = require('./airwallexBilling');
const { markPaid } = require('./billing');
const { logSiteActivity } = require('./activity');
const { sendMail } = require('./mailer');

const TERMINAL = new Set(['matched', 'ignored', 'reversed']);
const PAGE_SIZE = 100;
const MAX_PAGES = 30;
// Near-match window for sender-side transfer fees (Grey ACH $2, typical
// fintech $1–5; wires can exceed this and land in unmatched, by design).
const NEAR_TOLERANCE_CENTS = 500;

// ─── Airwallex fetch ─────────────────────────────────────────────────────────
// API quirks (verified live 2026-08-11): the list caps the from/to range at 31
// DAYS (400 beyond that), and with to_created_at omitted the window is measured
// from from_created_at — so a long lookback silently searches the wrong month.
// We chunk the lookback into 30-day windows (deduped on the overlap boundary).
// Response shape: { has_more, items, total_count }; page_size has a minimum (~10).
const isoSec = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

async function fetchDeposits({ sinceIso } = {}) {
  const out = [];
  const seen = new Set();
  const start = sinceIso ? new Date(sinceIso).getTime() : Date.now() - 7 * 86400000;
  const end = Date.now() + 60 * 1000;
  const WINDOW = 30 * 86400000;
  for (let ws = start; ws < end; ws += WINDOW) {
    const we = Math.min(ws + WINDOW, end);
    for (let page = 0; page < MAX_PAGES; page++) {
      const params = new URLSearchParams({
        page_num: String(page), page_size: String(PAGE_SIZE),
        from_created_at: isoSec(ws), to_created_at: isoSec(we),
      });
      const res = await awx(`/api/v1/deposits?${params}`, { method: 'GET' });
      const items = res?.items || [];
      for (const d of items) if (d?.id && !seen.has(d.id)) { seen.add(d.id); out.push(d); }
      if (items.length < PAGE_SIZE || !res?.has_more) break;
    }
  }
  return out;
}

// ─── Matching helpers ────────────────────────────────────────────────────────
const normRef = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
// The payment reference tenants are asked to include = first 8 chars of the
// charge id (hex, fits the 10-char USD deposit-reference cap). Same code the
// display ref INV-XXXXXXXX carries, so "INVFC394268" still contains it.
const chargeCode = (id) => String(id).slice(0, 8).toUpperCase();
const toCents = (amount) => Math.round(Number(amount) * 100);
// The tenant pays the tax-INCLUSIVE total (AIRWALLEX_INVOICING.md §8): the deposit
// is amount_cents (our commission/domain revenue) + tax_cents (collected-tax
// liability). Match against the total. Today tax_cents = 0 everywhere, so this is
// identical to matching amount_cents — zero behavior change until we register.
const chargeTotal = (c) => Number(c.amount_cents || 0) + Number(c.tax_cents || 0);
const normName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

async function loadOpenCharges() {
  const { data: charges, error } = await supabase
    .from('billing_charges')
    .select('*')
    .in('status', ['due', 'requested'])
    .limit(1000);
  if (error) throw new Error(error.message);
  const siteIds = [...new Set((charges || []).map((c) => c.site_id).filter(Boolean))];
  const { data: sites } = siteIds.length
    ? await supabase.from('sites').select('id, subdomain, company_id').in('id', siteIds)
    : { data: [] };
  const companyIds = [...new Set((sites || []).map((s) => s.company_id).filter(Boolean))];
  const { data: companies } = companyIds.length
    ? await supabase.from('companies').select('id, name').in('id', companyIds)
    : { data: [] };
  const companyById = Object.fromEntries((companies || []).map((c) => [c.id, c]));
  const siteById = Object.fromEntries((sites || []).map((s) => [s.id, s]));
  return (charges || []).map((c) => {
    const site = siteById[c.site_id];
    return {
      ...c,
      _subdomain: site?.subdomain || null,
      _payerName: companyById[site?.company_id]?.name || site?.subdomain || null,
    };
  });
}

const candidateItem = (c, reason) => ({
  charge_id: c.id,
  code: chargeCode(c.id),
  site_id: c.site_id,
  business: c._payerName,
  kind: c.kind,
  amount_cents: c.amount_cents,
  tax_cents: c.tax_cents || 0,
  total_cents: chargeTotal(c),
  status: c.status,
  created_at: c.created_at,
  reason,
});

// Pure matcher: one settled deposit vs the open-charge set.
// Returns { action: 'pay'|'review'|'unmatched', tier, charges, deltaCents, candidates }.
// deltaCents on a pay result = invoice − deposit (positive = shortfall the
// business writes off — Peter's call 2026-08-11: full automation, near matches
// auto-pay too; the CMS Billing notice tells tenants sender fees are theirs).
function matchDeposit(dep, openCharges, { nearToleranceCents = NEAR_TOLERANCE_CENTS } = {}) {
  const cents = toCents(dep.amount);
  const cur = String(dep.currency || '').toUpperCase();
  const depAt = new Date(dep.created_at);
  const tol = Number(nearToleranceCents) || 0;

  const eligible = openCharges.filter(
    (c) => String(c.currency || 'USD').toUpperCase() === cur && new Date(c.created_at) <= depAt,
  );

  // T1 — the deposit reference carries a charge code. The reference identifies
  // the invoice unambiguously, so the fee tolerance applies to the amount too.
  const ref = normRef(dep.reference);
  if (ref) {
    const refHits = eligible.filter((c) => ref.includes(chargeCode(c.id)));
    if (refHits.length === 1) {
      const diff = chargeTotal(refHits[0]) - cents;
      if (Math.abs(diff) <= tol) {
        return { action: 'pay', tier: 'T1', charges: refHits, deltaCents: diff };
      }
      return {
        action: 'review', tier: 'T1-amount-mismatch',
        candidates: refHits.map((c) => candidateItem(c, `reference matches but amount differs beyond tolerance (deposit ${cents}¢ vs invoice ${chargeTotal(c)}¢)`)),
      };
    }
    if (refHits.length > 1) {
      return { action: 'review', tier: 'T1-multi', candidates: refHits.map((c) => candidateItem(c, 'reference matches multiple invoices')) };
    }
  }

  // T2 — exact amount (tax-inclusive total), unique across ALL tenants.
  const amountHits = eligible.filter((c) => chargeTotal(c) === cents);
  if (amountHits.length === 1) return { action: 'pay', tier: 'T2', charges: amountHits, deltaCents: 0 };
  if (amountHits.length > 1) {
    return { action: 'review', tier: 'T3-multi-amount', candidates: amountHits.map((c) => candidateItem(c, 'exact amount, multiple candidate invoices')) };
  }

  // T2-near — the deposit lands slightly UNDER one invoice (the payer's
  // bank/processor skimmed a transfer fee in transit — e.g. Grey charges $2 on
  // ACH, so a tenant sending $200 lands $198; we only ever see what settles)
  // or slightly OVER (tenant padded for fees). AUTO-PAYS when exactly ONE
  // invoice is in tolerance; the delta is recorded on the charge as a
  // write-off/overpay so the books stay honest. Multiple invoices in
  // tolerance → review (ambiguity always gets a human).
  const nearHits = eligible
    .map((c) => ({ c, diff: chargeTotal(c) - cents }))
    .filter(({ diff }) => diff !== 0 && Math.abs(diff) <= tol);
  if (nearHits.length === 1) {
    return { action: 'pay', tier: 'T2-near', charges: [nearHits[0].c], deltaCents: nearHits[0].diff };
  }
  if (nearHits.length > 1) {
    return {
      action: 'review', tier: 'T3-near-multi',
      candidates: nearHits.map(({ c, diff }) => candidateItem(c, diff > 0
        ? `deposit is ${diff}¢ short of this invoice (likely a sender-side transfer fee)`
        : `deposit is ${-diff}¢ over this invoice (tenant may have padded for fees)`)),
    };
  }

  // T3 — one deposit covering the SUM of a site's open charges.
  const bySite = new Map();
  for (const c of eligible) {
    if (!c.site_id) continue;
    if (!bySite.has(c.site_id)) bySite.set(c.site_id, []);
    bySite.get(c.site_id).push(c);
  }
  for (const [, siteCharges] of bySite) {
    if (siteCharges.length > 1 && siteCharges.reduce((s, c) => s + chargeTotal(c), 0) === cents) {
      return { action: 'review', tier: 'T3-sum', candidates: siteCharges.map((c) => candidateItem(c, 'deposit equals the sum of this business\'s open invoices')) };
    }
  }

  // T3 — payer name resembles a tenant business (never auto-pay on name).
  const payer = normName(dep.payer?.name);
  if (payer) {
    const nameHits = eligible.filter((c) => {
      const biz = normName(c._payerName);
      return biz && (payer.includes(biz) || biz.includes(payer));
    });
    if (nameHits.length) {
      return { action: 'review', tier: 'T3-name', candidates: nameHits.map((c) => candidateItem(c, `payer "${dep.payer?.name}" resembles this business; amount does not match exactly`)) };
    }
  }

  return { action: 'unmatched' };
}

// ─── Persistence ─────────────────────────────────────────────────────────────
async function upsertDepositRow(dep, patch = {}) {
  const row = {
    id: dep.id,
    payload: dep,
    amount_cents: toCents(dep.amount),
    currency: String(dep.currency || '').toUpperCase(),
    payer_name: dep.payer?.name || null,
    reference: dep.reference || null,
    deposit_status: dep.status || null,
    deposit_created_at: dep.created_at || null,
    settled_at: dep.settled_at || null,
    ...patch,
  };
  const { error } = await supabase.from('recon_deposits').upsert(row, { onConflict: 'id' });
  if (error) throw new Error(error.message);
}

async function stampChargeRecon(charge, dep, { matchedBy, tier, deltaCents = 0 }) {
  const metadata = {
    ...(charge.metadata || {}),
    recon: {
      deposit_id: dep.id,
      provider_transaction_id: dep.provider_transaction_id || null,
      settled_at: dep.settled_at || null,
      matched_by: matchedBy,
      tier,
      matched_at: new Date().toISOString(),
      // invoice − deposit: positive = shortfall we write off (sender-side
      // transfer fee), negative = overpayment. 0 omitted for clean metadata.
      ...(deltaCents > 0 ? { shortfall_cents: deltaCents } : {}),
      ...(deltaCents < 0 ? { overpay_cents: -deltaCents } : {}),
      // Revenue vs collected-tax split (AIRWALLEX_INVOICING.md §8). Recorded only
      // when tax was actually charged, so the Compliance books can attribute the
      // liability per jurisdiction; omitted at today's 0% for clean metadata.
      ...(Number(charge.tax_cents) > 0
        ? { revenue_cents: Number(charge.amount_cents || 0), tax_collected_cents: Number(charge.tax_cents), tax_jurisdiction: charge.tax_jurisdiction || null }
        : {}),
    },
  };
  await supabase.from('billing_charges').update({ metadata }).eq('id', charge.id);
}

// Tenant email for a returned/rejected payment (best-effort, per-charge).
async function sendPaymentReturnedEmail(chargeId, { rejected = false } = {}) {
  try {
    const { loadChargeContext } = require('./billingEmails');
    const emails = require('../templates/transactionalEmails');
    const { cmsMagicLink } = require('./cmsMagicLink');
    const c = await loadChargeContext(chargeId);
    if (!c?.ownerEmail) return;
    const dashboardUrl = await cmsMagicLink(c.ownerAuthUserId, '/billing/invoices').catch(() => null);
    await sendMail({
      fromName: 'Stemfra Billing',
      to: c.ownerEmail,
      subject: rejected
        ? `Your transfer for ${c.invoiceRef} did not go through`
        : `Your payment for ${c.invoiceRef} was returned by your bank`,
      text: `${rejected ? 'Your bank transfer did not go through, so the invoice is still open.' : 'Your bank returned the transfer, so the invoice is open again.'} Please send a fresh transfer for the exact invoice amount (${c.amountLabel}) with the payment reference ${c.payRef}. If this is unexpected, just reply to this email.`,
      html: emails.platformPaymentReturned({
        businessName: c.businessName, greetingName: c.greetingName,
        amountLabel: c.amountLabel, invoiceRef: c.invoiceRef, payRef: c.payRef,
        dashboardUrl, rejected,
      }),
    });
  } catch (e) {
    console.error('[recon] payment-returned email failed:', e.message);
  }
}

// ─── Reversal (ACH return after settlement) ──────────────────────────────────
async function handleReversal(dep) {
  const { data: paidCharges } = await supabase
    .from('billing_charges')
    .select('*')
    .eq('status', 'paid')
    .filter('metadata->recon->>deposit_id', 'eq', dep.id);

  for (const charge of paidCharges || []) {
    const metadata = {
      ...(charge.metadata || {}),
      recon: {
        ...(charge.metadata?.recon || {}),
        reversed_at: new Date().toISOString(),
        original_paid_at: charge.paid_at,
      },
    };
    await supabase.from('billing_charges')
      .update({ status: 'requested', paid_at: null, metadata })
      .eq('id', charge.id);
    logSiteActivity({
      siteId: charge.site_id, action: 'invoice_payment_reversed', actorName: 'recon',
      entityType: 'billing_charge', entityId: charge.id,
      details: { deposit_id: dep.id, amount_cents: charge.amount_cents },
    }).catch(() => {});
    // Tenant email: the invoice is open again; re-send with the reference (R4).
    sendPaymentReturnedEmail(charge.id, { rejected: false });
  }

  await upsertDepositRow(dep, {
    status: 'reversed',
    matched_charge_ids: (paidCharges || []).map((c) => c.id),
    resolved_by: 'system:reversal',
    resolved_at: new Date().toISOString(),
  });

  // Staff alert (best-effort). Tenant-facing reversal email lands in R4.
  const to = process.env.NOTIFY_EMAIL || process.env.GMAIL_USER;
  if (to) {
    const n = (paidCharges || []).length;
    sendMail({
      fromName: 'Stemfra Billing',
      to,
      subject: `Deposit reversed: ${dep.currency} ${dep.amount} (${n} invoice${n === 1 ? '' : 's'} re-opened)`,
      text: `Airwallex deposit ${dep.id} (${dep.currency} ${dep.amount}, payer: ${dep.payer?.name || 'unknown'}) was REVERSED by the payer's bank.\n\nRe-opened invoices: ${(paidCharges || []).map((c) => `${chargeCode(c.id)} (${c.amount_cents}¢)`).join(', ') || 'none were linked'}.\n\nReview in the CRM Billing page.`,
    }).catch(() => {});
  }
  return { reversed: (paidCharges || []).length };
}

// ─── Core: one deposit through the engine ────────────────────────────────────
async function reconcileDeposit(dep, { dryRun = true, openCharges = null, nearToleranceCents } = {}) {
  const { data: existing } = await supabase.from('recon_deposits').select('id, status').eq('id', dep.id).maybeSingle();
  if (existing && TERMINAL.has(existing.status)) {
    // Terminal, except a settled→reversed flip which must still process.
    if (!(dep.status === 'REVERSED' && existing.status === 'matched')) return { skipped: existing.status };
  }

  if (dep.status === 'REVERSED') return handleReversal(dep);
  if (dep.status === 'REJECTED') {
    await upsertDepositRow(dep, { status: 'ignored', resolved_by: 'system:rejected', resolved_at: new Date().toISOString() });
    // If the failed transfer carried the reference of exactly one open invoice,
    // tell that tenant their payment did not go through (per the email matrix).
    const ref = normRef(dep.reference);
    if (ref) {
      const charges = openCharges || (await loadOpenCharges());
      const refHits = charges.filter((c) => ref.includes(chargeCode(c.id)));
      if (refHits.length === 1) sendPaymentReturnedEmail(refHits[0].id, { rejected: true });
    }
    return { rejected: true };
  }
  if (dep.status !== 'SETTLED') {
    await upsertDepositRow(dep, { status: 'pending' });
    return { pending: true };
  }

  const charges = openCharges || (await loadOpenCharges());
  const m = matchDeposit(dep, charges, { nearToleranceCents });

  if (m.action === 'pay') {
    if (dryRun) {
      await upsertDepositRow(dep, {
        status: 'review',
        candidates: { tier: m.tier, dry_run: true, note: `DRY RUN: would auto-pay (${m.tier})`, items: m.charges.map((c) => candidateItem(c, `auto-pay ${m.tier}`)) },
      });
      return { dryRun: true, tier: m.tier, wouldPay: m.charges.map((c) => c.id) };
    }
    // Idempotency: this deposit must not already back another paid charge.
    const { data: dup } = await supabase.from('billing_charges')
      .select('id').filter('metadata->recon->>deposit_id', 'eq', dep.id).limit(1);
    if (dup?.length) {
      await upsertDepositRow(dep, { status: 'matched', matched_charge_ids: dup.map((d) => d.id) });
      return { skipped: 'already-applied' };
    }
    const paidIds = [];
    for (const charge of m.charges) {
      // Re-check the charge is still open (another path may have paid it).
      const { data: fresh } = await supabase.from('billing_charges').select('*').eq('id', charge.id).maybeSingle();
      if (!fresh || !['due', 'requested'].includes(fresh.status)) continue;
      await stampChargeRecon(fresh, dep, { matchedBy: 'auto', tier: m.tier, deltaCents: m.deltaCents || 0 });
      await markPaid(charge.id, { by: null });
      paidIds.push(charge.id);
      logSiteActivity({
        siteId: charge.site_id, action: 'invoice_auto_paid', actorName: 'recon',
        entityType: 'billing_charge', entityId: charge.id,
        details: { deposit_id: dep.id, tier: m.tier, amount_cents: charge.amount_cents },
      }).catch(() => {});
    }
    await upsertDepositRow(dep, {
      status: paidIds.length ? 'matched' : 'review',
      matched_charge_ids: paidIds,
      candidates: paidIds.length ? null : { tier: m.tier, note: 'auto-pay target was no longer open', items: m.charges.map((c) => candidateItem(c, 'was already closed')) },
      resolved_by: paidIds.length ? 'system:auto' : null,
      resolved_at: paidIds.length ? new Date().toISOString() : null,
    });
    return { paid: paidIds, tier: m.tier };
  }

  if (m.action === 'review') {
    await upsertDepositRow(dep, { status: 'review', candidates: { tier: m.tier, items: m.candidates } });
    return { review: m.tier };
  }

  await upsertDepositRow(dep, { status: 'unmatched' });
  return { unmatched: true };
}

// ─── Tenant claim ("I've paid", R4) ──────────────────────────────────────────
// User-initiated verification for ONE charge: fetch deposits since the charge
// was created and see whether any settled deposit unambiguously pays THIS
// charge (T1/T2/T2-near where the matched charge IS this one). Runs live
// regardless of the sweeper's enabled/dry_run gates — the tenant explicitly
// asked us to check — but only ever pays the claimed charge.
async function claimCharge(charge, { nearToleranceCents } = {}) {
  const now = new Date().toISOString();
  const metadata = { ...(charge.metadata || {}), payment_claimed_at: now };
  await supabase.from('billing_charges').update({ metadata }).eq('id', charge.id);

  const sinceIso = new Date(Math.max(new Date(charge.created_at).getTime(), Date.now() - 45 * 86400000)).toISOString();
  const deposits = await fetchDeposits({ sinceIso });
  const openCharges = await loadOpenCharges();

  for (const dep of deposits) {
    if (dep.status !== 'SETTLED') continue;
    // Skip deposits already applied elsewhere.
    const { data: dup } = await supabase.from('billing_charges')
      .select('id').filter('metadata->recon->>deposit_id', 'eq', dep.id).limit(1);
    if (dup?.length) continue;
    const m = matchDeposit(dep, openCharges, { nearToleranceCents });
    if (m.action !== 'pay') continue;
    if (!m.charges.some((c) => c.id === charge.id)) continue;
    await stampChargeRecon({ ...charge, metadata }, dep, { matchedBy: 'claim', tier: m.tier, deltaCents: m.deltaCents || 0 });
    await markPaid(charge.id, { by: null });
    await upsertDepositRow(dep, {
      status: 'matched', matched_charge_ids: [charge.id],
      resolved_by: 'system:claim', resolved_at: new Date().toISOString(),
    });
    logSiteActivity({
      siteId: charge.site_id, action: 'invoice_auto_paid', actorName: 'recon:claim',
      entityType: 'billing_charge', entityId: charge.id,
      details: { deposit_id: dep.id, tier: m.tier },
    }).catch(() => {});
    return { status: 'paid', depositId: dep.id };
  }
  return { status: 'processing' };
}

// ─── Staff actions (CRM review queue / unmatched view) ───────────────────────
// Confirm: apply a deposit to specific charge(s) — the review queue's one-click.
async function applyDeposit(depositId, chargeIds, { by = null } = {}) {
  const { data: row } = await supabase.from('recon_deposits').select('*').eq('id', depositId).maybeSingle();
  if (!row) throw new Error('Deposit not found');
  if (row.status === 'matched') throw new Error('Deposit already applied');
  const dep = row.payload;
  const paidIds = [];
  for (const chargeId of chargeIds || []) {
    const { data: fresh } = await supabase.from('billing_charges').select('*').eq('id', chargeId).maybeSingle();
    if (!fresh || !['due', 'requested'].includes(fresh.status)) continue;
    const deltaCents = chargeTotal(fresh) - toCents(dep.amount);
    await stampChargeRecon(fresh, dep, { matchedBy: 'review', tier: row.candidates?.tier || 'manual', deltaCents: chargeIds.length === 1 ? deltaCents : 0 });
    await markPaid(chargeId, { by: null });
    paidIds.push(chargeId);
    logSiteActivity({
      siteId: fresh.site_id, action: 'invoice_auto_paid', actorName: by || 'staff',
      entityType: 'billing_charge', entityId: chargeId,
      details: { deposit_id: dep.id, matched_by: 'review', amount_cents: fresh.amount_cents },
    }).catch(() => {});
  }
  if (!paidIds.length) throw new Error('No open charges to apply this deposit to');
  await supabase.from('recon_deposits').update({
    status: 'matched', matched_charge_ids: paidIds, resolved_by: by || 'staff', resolved_at: new Date().toISOString(),
  }).eq('id', depositId);
  return { paid: paidIds };
}

// Ignore (e.g. Peter's own balance top-ups) / reopen back to unmatched.
async function setDepositStatus(depositId, status, { by = null } = {}) {
  if (!['ignored', 'unmatched'].includes(status)) throw new Error('Only ignored/unmatched can be set directly');
  const { error } = await supabase.from('recon_deposits').update({
    status, resolved_by: status === 'ignored' ? (by || 'staff') : null,
    resolved_at: status === 'ignored' ? new Date().toISOString() : null,
  }).eq('id', depositId);
  if (error) throw new Error(error.message);
  return { status };
}

// ─── Window sweep ────────────────────────────────────────────────────────────
async function reconcileWindow({ lookbackDays = 7, dryRun = true, nearToleranceCents } = {}) {
  if (!isConfigured()) throw new Error('Airwallex credentials not configured');
  const sinceIso = new Date(Date.now() - lookbackDays * 86400000).toISOString();
  const deposits = await fetchDeposits({ sinceIso });
  const openCharges = await loadOpenCharges();
  const results = [];
  for (const dep of deposits) {
    try {
      results.push({ id: dep.id, amount: dep.amount, currency: dep.currency, status: dep.status, payer: dep.payer?.name, reference: dep.reference, outcome: await reconcileDeposit(dep, { dryRun, openCharges, nearToleranceCents }) });
    } catch (e) {
      results.push({ id: dep.id, error: e.message });
    }
  }
  return { deposits: deposits.length, openCharges: openCharges.length, results };
}

module.exports = {
  fetchDeposits, loadOpenCharges, matchDeposit, reconcileDeposit, reconcileWindow,
  handleReversal, chargeCode, applyDeposit, setDepositStatus, claimCharge,
};
