// Pay-and-publish reactor (P12 §3 — the acquisition funnel's money moment).
// When a site's initial System-A payment clears, this opens the billing gate and
// auto-publishes the site (previewing → live) IF the publish checklist passes
// (publishSite also attaches the host). It's PROVIDER-AGNOSTIC — two entry points
// feed the SAME auto-publish core:
//   · onInitialChargePaid(charge)  — Payoneer ledger path (billing.markPaid); also
//                                    flips a PENDING subscription active.
//   · maybeAutoPublishSite(siteId) — called directly by the Stripe System-A
//                                    webhook once its checkout marks the sub active.
// Opt-out per site via sites.metadata.publish_on_payment === false. Best-effort
// throughout — it must NEVER throw back into the payment path.
const supabase = require('../../config/supabase');
const { publishSite } = require('../sitePublish');
const { logSiteActivity } = require('../activity');

/**
 * Auto-publish a site if the gate is open and it's opted in. No-op for
 * already-live or opted-out sites; stays in preview (with an audit note) when the
 * checklist isn't complete. Never throws.
 */
async function maybeAutoPublishSite(siteId, { source = 'pay_and_publish', chargeId = null } = {}) {
  try {
    if (!siteId) return;
    const { data: site } = await supabase.from('sites')
      .select('id, status, metadata').eq('id', siteId).maybeSingle();
    if (!site) return;
    if (site.status === 'live') return;                       // already live — idempotent
    if (site.metadata?.publish_on_payment === false) return;  // opted out of auto-publish

    try {
      // publishSite re-checks the completeness checklist + the (now-open) billing
      // gate, attaches the host, and flips previewing → live.
      const result = await publishSite(siteId);
      await logSiteActivity({
        siteId, actorName: 'system (pay-and-publish)',
        action: 'site_auto_published', entityType: 'site', entityId: siteId,
        details: { trigger: source, charge_id: chargeId, domain: result?.domain || null },
      }).catch(() => {});
      return result;
    } catch (err) {
      if (err.code === 'not_ready') {
        // Paid, gate open, but required checklist items are missing → stay in
        // preview. The gate is now open, so the owner publishes once they finish
        // (or a later publish attempt succeeds). Record it so it's visible.
        await logSiteActivity({
          siteId, actorName: 'system (pay-and-publish)',
          action: 'pay_and_publish_pending_checklist', entityType: 'site', entityId: siteId,
          details: { trigger: source, charge_id: chargeId, reason: 'checklist_incomplete' },
        }).catch(() => {});
        return;
      }
      // Any other publish failure (e.g. bad_state) — log, don't crash the payment.
      console.error('[pay-and-publish] publish error for site', siteId, '-', err.message);
    }
  } catch (err) {
    console.error('[pay-and-publish] maybeAutoPublishSite error:', err.message);
  }
}

/**
 * React to an INITIAL charge flipping to 'paid' (the Payoneer ledger path). Opens
 * the billing gate (pending subscription → active) then auto-publishes. No-op for
 * recurring charges. Never throws.
 * @param {object} charge the paid billing_charges row (kind/site_id/subscription_id/id)
 */
async function onInitialChargePaid(charge) {
  try {
    if (!charge || charge.kind !== 'initial' || !charge.site_id) return;

    // Open the billing gate: a pending subscription becomes active on payment.
    // Scoped to status='pending' so a re-run (or an already-active sub) is a
    // no-op — recurring/plan-change flows are never re-activated here.
    if (charge.subscription_id) {
      await supabase.from('subscriptions')
        .update({ status: 'active', started_at: new Date().toISOString() })
        .eq('id', charge.subscription_id).eq('status', 'pending');
    }

    await maybeAutoPublishSite(charge.site_id, { source: 'pay_and_publish', chargeId: charge.id });
  } catch (err) {
    console.error('[pay-and-publish] reactor error:', err.message);
  }
}

module.exports = { onInitialChargePaid, maybeAutoPublishSite };
