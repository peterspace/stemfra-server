// Shared platform audit logger → site_activity (our own table; site-scoped via a
// real site_id column). Best-effort: a logging failure never breaks the action
// that triggered it. NB: distinct from the CRM's activity_feed table, whose
// entity_type CHECK only allows CRM types — platform events go HERE instead.
const supabase = require('../config/supabase');

async function logSiteActivity({ siteId, actorName, action, entityType, entityId, entityName, details }) {
  try {
    if (!siteId || !action) return;
    const finalDetails = entityName ? { ...(details || {}), entity_name: entityName } : (details || null);
    const { error } = await supabase.from('site_activity').insert({
      site_id: siteId,
      action,
      actor_name: actorName || null,
      entity_type: entityType || null,
      entity_id: entityId || null,
      details: finalDetails,
    });
    if (error) console.warn('[activity] log failed:', error.message);
  } catch (e) {
    console.warn('[activity] log failed:', e.message);
  }
}

module.exports = { logSiteActivity };
