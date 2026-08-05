// CMS — recent site activity (money-action audit trail). Reads the platform
// site_activity table by site_id (service-role client). Single-var supabase require.
const supabase = require('../../config/supabase');
const { verifySiteOwnership } = require('../../middleware/cmsAuth');

async function listActivity(req, res) {
  try {
    const siteId = req.query.siteId;
    if (!siteId) return res.status(400).json({ success: false, message: 'Missing siteId.' });
    const site = await verifySiteOwnership(req.cmsUser.id, siteId);
    if (!site) return res.status(403).json({ success: false, message: 'Not your site.' });
    const { data, error } = await supabase
      .from('site_activity')
      .select('id, action, entity_type, entity_id, actor_name, details, created_at')
      .eq('site_id', siteId)
      .order('created_at', { ascending: false })
      .limit(25);
    if (error) return res.status(500).json({ success: false, message: error.message });
    res.json({ success: true, events: data || [] });
  } catch (err) {
    console.error('[activity.list]', err.message);
    res.status(500).json({ success: false, message: 'Could not load activity.' });
  }
}

// POST — owner-originated audit events. Owners have no INSERT policy on
// site_activity (by design — the service role writes audits), so client-side
// booking mutations log through here. Allowlisted actions only: this endpoint
// exists for the CMS's own UI, not as a general write path.
const { logSiteActivity } = require('../../lib/activity');

const OWNER_ACTIONS = new Set(['rescheduled', 'staff_reassigned']);

async function recordActivity(req, res) {
  try {
    const { siteId, action, entityType, entityId, details } = req.body || {};
    if (!siteId || !action) return res.status(400).json({ success: false, message: 'Missing siteId or action.' });
    if (!OWNER_ACTIONS.has(action)) return res.status(400).json({ success: false, message: 'Unsupported action.' });
    const site = await verifySiteOwnership(req.cmsUser.id, siteId);
    if (!site) return res.status(403).json({ success: false, message: 'Not your site.' });
    await logSiteActivity({
      siteId,
      actorName: req.cmsUser.email || null,
      action,
      entityType: entityType || null,
      entityId: entityId || null,
      details: details && typeof details === 'object' ? details : null,
    });
    res.json({ success: true });
  } catch (err) {
    console.error('[activity.record]', err.message);
    res.status(500).json({ success: false, message: 'Could not record activity.' });
  }
}

module.exports = { listActivity, recordActivity };
