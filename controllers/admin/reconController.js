// Recon R3 — CRM surfaces for the Billing Reconciliation Engine
// (docs/RECONCILIATION.md): deposits list (review queue + unmatched + history),
// one-click confirm/ignore, settings (interval/dry-run/tolerance, read by the
// sweeper every cycle so changes need no restart), on-demand sweep, and the
// per-invoice "request receipt" toggle (receipts are dispute-only now).
const supabase = require('../../config/supabase');
const { reconcileWindow, applyDeposit, setDepositStatus } = require('../../lib/reconEngine');
const { readReconSettings, DEFAULTS } = require('../../lib/reconSweeper');
const { loadChargeContext } = require('../../lib/billingEmails');
const { sendMail } = require('../../lib/mailer');
const emails = require('../../templates/transactionalEmails');
const { cmsMagicLink } = require('../../lib/cmsMagicLink');
const { logSiteActivity } = require('../../lib/activity');

const staffName = (req) => req.staffUser?.email || req.staffUser?.id || 'staff';

// GET /api/admin/recon/deposits?status=
async function listDeposits(req, res) {
  try {
    let q = supabase.from('recon_deposits').select('*').order('deposit_created_at', { ascending: false }).limit(500);
    if (req.query.status) q = q.eq('status', req.query.status);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return res.json({ deposits: data || [] });
  } catch (e) { return res.status(500).json({ error: e.message }); }
}

// POST /api/admin/recon/deposits/:id/resolve { chargeIds: [] }
async function resolveDeposit(req, res) {
  try {
    const { chargeIds } = req.body || {};
    if (!Array.isArray(chargeIds) || !chargeIds.length) return res.status(400).json({ error: 'chargeIds is required' });
    const out = await applyDeposit(req.params.id, chargeIds, { by: staffName(req) });
    return res.json(out);
  } catch (e) { return res.status(400).json({ error: e.message }); }
}

// POST /api/admin/recon/deposits/:id/ignore  { undo?: boolean }
async function ignoreDeposit(req, res) {
  try {
    const out = await setDepositStatus(req.params.id, req.body?.undo ? 'unmatched' : 'ignored', { by: staffName(req) });
    return res.json(out);
  } catch (e) { return res.status(400).json({ error: e.message }); }
}

// GET /api/admin/recon/settings
async function getSettings(_req, res) {
  try { return res.json({ settings: await readReconSettings(), defaults: DEFAULTS }); }
  catch (e) { return res.status(500).json({ error: e.message }); }
}

// POST /api/admin/recon/settings { enabled?, dry_run?, interval_minutes?, lookback_days?, near_tolerance_cents? }
async function saveSettings(req, res) {
  try {
    const current = await readReconSettings();
    const patch = req.body || {};
    const next = { ...current };
    if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled;
    if (typeof patch.dry_run === 'boolean') next.dry_run = patch.dry_run;
    for (const k of ['interval_minutes', 'lookback_days', 'near_tolerance_cents']) {
      if (patch[k] != null) {
        const n = Number(patch[k]);
        if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: `${k} must be a non-negative number` });
        next[k] = n;
      }
    }
    if (next.interval_minutes && next.interval_minutes < 5) return res.status(400).json({ error: 'interval_minutes must be at least 5' });
    const { error } = await supabase.from('crm_settings').upsert({ key: 'billing_recon', value: next }, { onConflict: 'key' });
    if (error) throw new Error(error.message);
    return res.json({ settings: next });
  } catch (e) { return res.status(500).json({ error: e.message }); }
}

// POST /api/admin/recon/sweep — run a check now (respects dry_run + tolerance).
async function runSweep(_req, res) {
  try {
    const s = await readReconSettings();
    const out = await reconcileWindow({
      lookbackDays: Number(s.lookback_days) || DEFAULTS.lookback_days,
      dryRun: s.dry_run !== false,
      nearToleranceCents: s.near_tolerance_cents,
    });
    return res.json({ deposits: out.deposits, openCharges: out.openCharges, dryRun: s.dry_run !== false });
  } catch (e) { return res.status(500).json({ error: e.message }); }
}

// POST /api/admin/billing-recon/charges/:chargeId/request-receipt { on: boolean }
// Toggles metadata.receipt_requested; turning it ON un-hides the CMS upload for
// that invoice and sends the polite request email (best-effort).
async function requestReceipt(req, res) {
  try {
    const on = req.body?.on !== false;
    const { data: charge, error } = await supabase.from('billing_charges').select('*').eq('id', req.params.chargeId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!charge) return res.status(404).json({ error: 'Charge not found' });
    const metadata = { ...(charge.metadata || {}), receipt_requested: on || undefined };
    if (!on) delete metadata.receipt_requested;
    const { error: upErr } = await supabase.from('billing_charges').update({ metadata }).eq('id', charge.id);
    if (upErr) throw new Error(upErr.message);

    logSiteActivity({
      siteId: charge.site_id, action: on ? 'invoice_receipt_requested' : 'invoice_receipt_request_cleared',
      actorName: staffName(req), entityType: 'billing_charge', entityId: charge.id,
    }).catch(() => {});

    if (on) {
      // Best-effort polite email; the toggle succeeds regardless.
      (async () => {
        const c = await loadChargeContext(charge.id);
        if (!c?.ownerEmail) return;
        const dashboardUrl = await cmsMagicLink(c.ownerAuthUserId, '/billing/invoices').catch(() => null);
        await sendMail({
          fromName: 'Stemfra Billing',
          to: c.ownerEmail,
          subject: `A quick favor: your payment receipt for ${c.invoiceRef}`,
          text: `To help us verify your payment for invoice ${c.invoiceRef}, could you share the transfer receipt from your bank? You can upload it in your dashboard under Billing, Invoices. Already sent it? Just reply to this email.`,
          html: emails.platformReceiptRequest({
            businessName: c.businessName, greetingName: c.greetingName,
            amountLabel: c.amountLabel, invoiceRef: c.invoiceRef, dashboardUrl,
          }),
        });
      })().catch((e) => console.error('[recon] receipt-request email failed:', e.message));
    }
    return res.json({ ok: true, receipt_requested: on });
  } catch (e) { return res.status(500).json({ error: e.message }); }
}

module.exports = { listDeposits, resolveDeposit, ignoreDeposit, getSettings, saveSettings, runSweep, requestReceipt };
