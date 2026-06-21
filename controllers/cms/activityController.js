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

module.exports = { listActivity };
