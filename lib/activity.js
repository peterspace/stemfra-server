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

// CRM activity-feed logger — lifted from routes/twilio.js (2026-07-21, per the
// standing convention once a second caller needed it; consumers: twilio.js call
// logging + the Voice agent's post-call finalize). activity_feed's entity_type
// CHECK allows CRM types only ('lead'/'contact'/…) — platform events use
// logSiteActivity above instead. Best-effort, never throws.
async function logActivity({ action, entityType, entityId, actorId, actorName, entityName, details }) {
  try {
    await supabase.from('activity_feed').insert([{
      action,
      entity_type: entityType,
      entity_id:   entityId,
      entity_name: entityName || null,
      actor_id:    actorId   || null,
      actor_name:  actorName || null,
      details:     details   || {},
    }]);
  } catch (err) {
    console.warn('[activity] crm log failed:', err.message);
  }
}

module.exports = { logSiteActivity, logActivity };
