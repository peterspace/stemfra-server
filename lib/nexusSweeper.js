// Nexus alert sweeper — the proactive answer to "how are we notified when our
// sales into a state approach the tax threshold?" (Peter, 2026-08-10). Daily,
// it rolls up Stemfra's REAL billed sales per US state (demo-excluded, reusing
// the compliance charge loader) and emails staff when a state hits >= 80% of
// its economic-nexus threshold, so we can register before we owe. Gated OFF by
// default (NEXUS_ALERTS_ENABLED=true to arm) — pre-launch there is nothing to
// alert on. Mirrors the renewal / commission sweeper shape.
const supabase = require('../config/supabase');
const { loadBillableCharges } = require('../controllers/admin/complianceController');
const { nexusPct } = require('./taxThresholds');
const { sendMail } = require('./mailer');

const ALERT_PCT = 0.8;

// Per-US-state billed rollup over the last 12 months (real invoices only).
async function computeExposure() {
  const since = new Date(Date.now() - 365 * 86400000).toISOString();
  const charges = await loadBillableCharges({ sinceIso: since, statuses: ['requested', 'paid'] });
  const byJur = new Map();
  for (const c of charges) {
    const key = c.juris.jurisdiction;
    if (!/^US-[A-Z]{2}$/.test(key)) continue; // US states only (these thresholds are US)
    if (!byJur.has(key)) byJur.set(key, { jurisdiction: key, label: c.juris.label, billedCents: 0, invoiceCount: 0 });
    const j = byJur.get(key);
    j.billedCents += Number(c.amount_cents) || 0;
    j.invoiceCount += 1;
  }
  return [...byJur.values()];
}

async function sweepOnce({ dryRun = false } = {}) {
  const exposure = await computeExposure();
  const approaching = exposure.filter((j) => nexusPct(j.jurisdiction, j.billedCents, j.invoiceCount) >= ALERT_PCT);

  // Only email a state ONCE while it stays above the line (stamp in settings).
  const { data } = await supabase.from('compliance_settings').select('value').eq('key', 'nexus_alerts').maybeSingle();
  const alerted = data?.value || {};
  const fresh = approaching.filter((j) => !alerted[j.jurisdiction]);
  if (dryRun) return { approaching, fresh };

  const to = process.env.NOTIFY_EMAIL || process.env.GMAIL_USER;
  if (fresh.length && to) {
    const lines = fresh.map((j) => `${j.label}: $${(j.billedCents / 100).toLocaleString()} over ${j.invoiceCount} invoice(s) — ${Math.round(nexusPct(j.jurisdiction, j.billedCents, j.invoiceCount) * 100)}% of threshold`);
    await sendMail({
      fromName: 'Stemfra Compliance',
      to,
      subject: `Nexus alert: ${fresh.length} state(s) approaching the sales-tax threshold`,
      text: `These US states are at or above ${ALERT_PCT * 100}% of their economic-nexus threshold. Review whether to register and collect:\n\n${lines.join('\n')}\n\nOpen the CRM: Compliance → Tax registry → Nexus tracking.`,
    }).catch((e) => console.error('[nexus] alert email failed:', e.message));
  }

  // Refresh stamps: keep the ones still approaching, drop those that fell back.
  const next = {};
  const now = new Date().toISOString();
  for (const j of approaching) next[j.jurisdiction] = alerted[j.jurisdiction] || now;
  if (JSON.stringify(next) !== JSON.stringify(alerted)) {
    await supabase.from('compliance_settings').upsert({ key: 'nexus_alerts', value: next }, { onConflict: 'key' });
  }
  if (fresh.length) console.log(`[nexus] alerted ${fresh.length} state(s) approaching threshold`);
  return { approaching, fresh };
}

function startNexusSweeper({ intervalMs = 24 * 3600 * 1000 } = {}) {
  if (process.env.NEXUS_ALERTS_ENABLED !== 'true') {
    console.log('• Nexus alert sweeper DISABLED (set NEXUS_ALERTS_ENABLED=true to arm)');
    return null;
  }
  setTimeout(() => sweepOnce().catch(() => {}), 60000);
  const t = setInterval(() => sweepOnce().catch(() => {}), intervalMs);
  console.log('✓ Nexus alert sweeper running (daily; emails staff when a US state hits 80% of its nexus threshold)');
  return t;
}

module.exports = { sweepOnce, startNexusSweeper, computeExposure };
