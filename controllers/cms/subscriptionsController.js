// CMS — owner management of member subscriptions (System B). Cancel (now or at
// period end), pause/freeze (Stripe pause_collection), resume. The webhook keeps
// status in sync too; we also update the row immediately for a responsive UI.
// Single-var supabase require per convention.
const supabase = require('../../config/supabase');
const { stripe } = require('../../config/stripe');
const { verifySiteOwnership } = require('../../middleware/cmsAuth');
const { logSiteActivity } = require('../../lib/activity');

function logSub(req, sub, action, details) {
  return logSiteActivity({
    siteId: sub.site_id, actorName: req.cmsUser?.email,
    action, entityType: 'site_subscription', entityId: sub.id, details,
  });
}

async function loadOwned(req, res) {
  const { data: sub } = await supabase
    .from('site_subscriptions').select('*').eq('id', req.params.id).single();
  if (!sub) { res.status(404).json({ success: false, message: 'Subscription not found.' }); return null; }
  const site = await verifySiteOwnership(req.cmsUser.id, sub.site_id);
  if (!site) { res.status(403).json({ success: false, message: 'Not your site.' }); return null; }
  if (!stripe) { res.status(503).json({ success: false, message: 'Stripe not configured.' }); return null; }
  if (!sub.stripe_subscription_id) { res.status(400).json({ success: false, message: 'No Stripe subscription.' }); return null; }
  return sub;
}

async function cancelSubscription(req, res) {
  try {
    const sub = await loadOwned(req, res); if (!sub) return;
    const mode = req.body?.mode === 'now' ? 'now' : 'period_end';
    if (mode === 'now') {
      await stripe.subscriptions.cancel(sub.stripe_subscription_id);
      await supabase.from('site_subscriptions')
        .update({ status: 'canceled', canceled_at: new Date().toISOString(), cancel_at_period_end: false })
        .eq('id', sub.id);
    } else {
      await stripe.subscriptions.update(sub.stripe_subscription_id, { cancel_at_period_end: true });
      await supabase.from('site_subscriptions').update({ cancel_at_period_end: true }).eq('id', sub.id);
    }
    await logSub(req, sub, 'subscription_cancelled', { mode });
    res.json({ success: true, mode });
  } catch (err) {
    console.error('[subscriptions.cancel]', err.message);
    res.status(500).json({ success: false, message: 'Could not cancel.' });
  }
}

async function pauseSubscription(req, res) {
  try {
    const sub = await loadOwned(req, res); if (!sub) return;
    await stripe.subscriptions.update(sub.stripe_subscription_id, { pause_collection: { behavior: 'void' } });
    // Stripe keeps status 'active' while paused, so we flag it in metadata.
    await supabase.from('site_subscriptions')
      .update({ metadata: { ...(sub.metadata || {}), paused: true } }).eq('id', sub.id);
    await logSub(req, sub, 'subscription_paused', null);
    res.json({ success: true });
  } catch (err) {
    console.error('[subscriptions.pause]', err.message);
    res.status(500).json({ success: false, message: 'Could not pause.' });
  }
}

async function resumeSubscription(req, res) {
  try {
    const sub = await loadOwned(req, res); if (!sub) return;
    await stripe.subscriptions.update(sub.stripe_subscription_id, { pause_collection: '' });
    const md = { ...(sub.metadata || {}) }; delete md.paused;
    await supabase.from('site_subscriptions').update({ metadata: md }).eq('id', sub.id);
    await logSub(req, sub, 'subscription_resumed', null);
    res.json({ success: true });
  } catch (err) {
    console.error('[subscriptions.resume]', err.message);
    res.status(500).json({ success: false, message: 'Could not resume.' });
  }
}

module.exports = { cancelSubscription, pauseSubscription, resumeSubscription };
