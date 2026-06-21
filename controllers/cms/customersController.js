// CMS — owner suspends/unsuspends a member (hard account block). A suspended
// member can't book or use their portal actions; suspending also pauses their
// active subscription (billing stops). Suspend state lives in
// site_customers.metadata.suspended (no schema change). Single-var supabase require.
const supabase = require('../../config/supabase');
const { stripe } = require('../../config/stripe');
const { verifySiteOwnership } = require('../../middleware/cmsAuth');
const { logSiteActivity } = require('../../lib/activity');

/** POST /api/cms/customers/:id/suspend  { suspend: boolean } */
async function setSuspended(req, res) {
  try {
    const { id } = req.params;
    const suspend = req.body?.suspend !== false; // default true
    const { data: cust } = await supabase
      .from('site_customers').select('id, site_id, email, metadata').eq('id', id).single();
    if (!cust) return res.status(404).json({ success: false, message: 'Member not found.' });
    const site = await verifySiteOwnership(req.cmsUser.id, cust.site_id);
    if (!site) return res.status(403).json({ success: false, message: 'Not your site.' });

    const md = { ...(cust.metadata || {}) };
    if (suspend) { md.suspended = true; md.suspended_at = new Date().toISOString(); }
    else { delete md.suspended; delete md.suspended_at; }
    await supabase.from('site_customers').update({ metadata: md }).eq('id', id);

    // Suspending also pauses any active subscription (billing stops). Unsuspending
    // does NOT auto-resume — the owner resumes deliberately.
    if (suspend && stripe) {
      const { data: subs } = await supabase
        .from('site_subscriptions').select('id, stripe_subscription_id, metadata')
        .eq('customer_id', id).not('stripe_subscription_id', 'is', null);
      for (const s of subs || []) {
        try {
          await stripe.subscriptions.update(s.stripe_subscription_id, { pause_collection: { behavior: 'void' } });
          await supabase.from('site_subscriptions').update({ metadata: { ...(s.metadata || {}), paused: true } }).eq('id', s.id);
        } catch (e) { console.warn('[suspend pause]', e.message); }
      }
    }

    await logSiteActivity({
      siteId: cust.site_id, actorName: req.cmsUser?.email,
      action: suspend ? 'member_suspended' : 'member_unsuspended',
      entityType: 'site_customer', entityId: id, entityName: cust.email,
    });
    res.json({ success: true, suspended: suspend });
  } catch (err) {
    console.error('[customers.setSuspended]', err.message);
    res.status(500).json({ success: false, message: 'Could not update member.' });
  }
}

module.exports = { setSuspended };
