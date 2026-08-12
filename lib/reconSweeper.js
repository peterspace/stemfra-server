// Billing Reconciliation sweeper (docs/RECONCILIATION.md R1) — the polling
// BACKSTOP behind the deposit webhooks (and the only mechanism until the
// webhook is registered). Self-scheduling setTimeout loop (NOT setInterval) so
// the CRM-adjusted interval takes effect on the next cycle without a restart.
//
// Gates, outermost first:
//   RECON_ENABLED=true      env kill switch (mirrors NEXUS_ALERTS_ENABLED; inert otherwise)
//   settings.enabled        crm_settings key 'billing_recon' (CRM-adjustable)
//   settings.dry_run        true (default) = record would-be matches, mark NOTHING paid
const supabase = require('../config/supabase');
const { reconcileWindow } = require('./reconEngine');

const DEFAULTS = { enabled: false, dry_run: true, interval_minutes: 360, lookback_days: 7, near_tolerance_cents: 500 };

async function readReconSettings() {
  try {
    const { data } = await supabase.from('crm_settings').select('value').eq('key', 'billing_recon').maybeSingle();
    return { ...DEFAULTS, ...(data?.value || {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

function startReconSweeper() {
  if (process.env.RECON_ENABLED !== 'true') {
    console.log('[recon] sweeper disabled (set RECON_ENABLED=true to arm)');
    return;
  }
  const tick = async () => {
    let intervalMinutes = DEFAULTS.interval_minutes;
    try {
      const s = await readReconSettings();
      intervalMinutes = Number(s.interval_minutes) || DEFAULTS.interval_minutes;
      if (s.enabled) {
        const dryRun = s.dry_run !== false; // explicit false is the only way to arm auto-pay
        const out = await reconcileWindow({
          lookbackDays: Number(s.lookback_days) || DEFAULTS.lookback_days,
          dryRun,
          nearToleranceCents: Number(s.near_tolerance_cents) ?? DEFAULTS.near_tolerance_cents,
        });
        console.log(`[recon] sweep done (dryRun=${dryRun}): ${out.deposits} deposits vs ${out.openCharges} open charges`);
      }
    } catch (e) {
      console.error('[recon] sweep failed:', e.message);
    }
    setTimeout(tick, Math.max(5, intervalMinutes) * 60 * 1000);
  };
  setTimeout(tick, 30 * 1000); // first pass shortly after boot
  console.log('[recon] sweeper armed (crm_settings.billing_recon controls enable/interval/dry_run)');
}

module.exports = { startReconSweeper, readReconSettings, DEFAULTS };
