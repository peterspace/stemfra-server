// ─── Speed-to-Lead — fire the n8n instant-engagement workflow ────────────────
//
// When a WARM inbound lead arrives (website contact form today; chatbot / inbound
// call later), we kick off the n8n speed-to-lead workflow. That workflow does the
// instant first-touch (SMS + email) and notifies the assigned rep, then sets an
// escalation timer. The clock that matters — time-to-first-touch — is measured
// from leads.arrival_at, which the DB stamps at insert.
//
// This module is the TRIGGER + LOGGING only. It does not send SMS/email itself;
// that is the n8n workflow's job (separate task).
//
// Two ways in:
//   1. fireSpeedToLead(leadId, { source }) — called in-process right after a warm
//      lead is created (e.g. from contactController). Fire-and-forget: it must
//      never throw into / block the caller's happy path.
//   2. POST /api/speed-to-lead/engage { lead_id } — authenticated endpoint so the
//      CRM (or any other path) can trigger engagement for an existing lead.
//
// n8n is reached at its PUBLIC webhook URL (NOT loopback — that doesn't work
// across Docker containers on the VPS) and authenticated with the shared
// x-leadgen-secret header, same as the lead-gen trigger.
//
// Env:
//   N8N_SPEED_TO_LEAD_URL — full public webhook URL for the speed-to-lead
//                           workflow, e.g.
//                           https://n8n.srv1555257.hstgr.cloud/webhook/speed-to-lead
//   N8N_WEBHOOK_SECRET    — shared secret, sent as the x-leadgen-secret header
//                           (reused from lead-gen; same n8n instance).

const express  = require('express');
const supabase = require('../config/supabase');

const router = express.Router();

async function validateUserSession(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

/**
 * Fire the speed-to-lead engagement for a single lead.
 *
 * Logs a `lead_arrived` engagement event (the DB triggers auto-compute
 * seconds_from_arrival and mirror it to activity_feed), then fires the n8n
 * webhook. Best-effort throughout: returns a small result object and never
 * throws, so callers can fire-and-forget without try/catch.
 *
 * @param {string} leadId
 * @param {object} [opts]
 * @param {string} [opts.source]   - where the engagement was triggered from
 *                                   ('website','crm','chatbot','inbound_call')
 * @param {string} [opts.actorId]  - profiles.id of the human who triggered it,
 *                                   if any (null for automated/system triggers)
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
async function fireSpeedToLead(leadId, opts = {}) {
  const { source = 'website', actorId = null } = opts;

  if (!leadId) return { ok: false, reason: 'missing_lead_id' };

  // Pull the lead so we (a) confirm it's warm + pending and (b) have phone/email
  // to pass to n8n. Cheap single-row read.
  const { data: lead, error: leadErr } = await supabase
    .from('leads')
    .select('id, contact_name, company_name, email, phone, service, source, lead_temperature, engagement_status, arrival_at, assigned_to, template_slug')
    .eq('id', leadId)
    .single();

  if (leadErr || !lead) {
    console.warn('[speed-to-lead] lead not found:', leadId, leadErr?.message);
    return { ok: false, reason: 'lead_not_found' };
  }

  // Only engage warm leads that haven't already been engaged. Cold lead-gen
  // leads (review-gated) must never auto-engage from here.
  if (lead.lead_temperature !== 'warm') {
    return { ok: false, reason: `not_warm (${lead.lead_temperature})` };
  }
  if (lead.engagement_status && lead.engagement_status !== 'pending') {
    return { ok: false, reason: `already_engaged (${lead.engagement_status})` };
  }

  // 1. Log the arrival event. DB triggers handle seconds_from_arrival + the
  //    activity_feed mirror, so we only insert the row. Best-effort: a failure
  //    here must not block the webhook fire below. supabase-js builders are
  //    thenable-only (no .catch), so we await + check { error } and wrap in
  //    try/catch to cover both response-shape errors and thrown rejections.
  try {
    const { error: eventErr } = await supabase.from('lead_engagement_events').insert([{
      lead_id:    lead.id,
      event_type: 'lead_arrived',
      channel:    'system',
      actor_type: actorId ? 'human' : 'system',
      actor_id:   actorId,
      details:    { source },
    }]);
    if (eventErr) console.warn('[speed-to-lead] event log failed (non-fatal):', eventErr.message);
  } catch (e) {
    console.warn('[speed-to-lead] event log failed (non-fatal):', e.message);
  }

  // 2. Move the lead into 'engaging' so a duplicate trigger is a no-op.
  // The .eq('engagement_status', 'pending') is an optimistic guard against
  // double-fire — only flips if it's still pending.
  try {
    const { error: updateErr } = await supabase.from('leads')
      .update({ engagement_status: 'engaged' })
      .eq('id', lead.id)
      .eq('engagement_status', 'pending');
    if (updateErr) console.warn('[speed-to-lead] status update failed (non-fatal):', updateErr.message);
  } catch (e) {
    console.warn('[speed-to-lead] status update failed (non-fatal):', e.message);
  }

  // 3. Fire the n8n webhook. If it's not configured yet, we've still logged the
  //    arrival and flipped status — the escalation scan (separate task) will be
  //    the backstop. Degrade gracefully exactly like the reserved warm lead-gen path.
  const webhookUrl = process.env.N8N_SPEED_TO_LEAD_URL;
  if (!webhookUrl) {
    console.warn('[speed-to-lead] N8N_SPEED_TO_LEAD_URL not set — logged arrival but no workflow fired.');
    return { ok: false, reason: 'webhook_not_configured' };
  }

  const payload = {
    lead_id:       lead.id,
    contact_name:  lead.contact_name,
    company_name:  lead.company_name,
    email:         lead.email,
    phone:         lead.phone,
    service:       lead.service,
    template_slug: lead.template_slug,
    assigned_to:   lead.assigned_to,
    source,
    arrival_at:    lead.arrival_at,
    triggered_at:  new Date().toISOString(),
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);

    const headers = { 'Content-Type': 'application/json' };
    if (process.env.N8N_WEBHOOK_SECRET) {
      headers['x-leadgen-secret'] = process.env.N8N_WEBHOOK_SECRET;
    }

    const r = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!r.ok) {
      const text = await r.text().catch(() => '');
      console.error('[speed-to-lead] n8n webhook returned', r.status, text);
      return { ok: false, reason: `n8n_${r.status}` };
    }
    return { ok: true };
  } catch (err) {
    if (err.name === 'AbortError') {
      // Kicked off but slow to respond — the workflow keeps running. Treat as success.
      console.warn('[speed-to-lead] n8n webhook timed out (run likely still in progress)');
      return { ok: true };
    }
    console.error('[speed-to-lead] trigger error:', err.message);
    return { ok: false, reason: err.message };
  }
}

// POST /api/speed-to-lead/engage  { lead_id }
// Authenticated: the CRM (or any internal caller) can (re)trigger engagement.
router.post('/engage', async (req, res) => {
  const user = await validateUserSession(req);
  if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });

  const { lead_id } = req.body || {};
  if (!lead_id) return res.status(400).json({ success: false, message: 'lead_id is required.' });

  const result = await fireSpeedToLead(lead_id, { source: 'crm', actorId: user.id });

  if (!result.ok) {
    // Distinguish "nothing to do" (already engaged / not warm) from real failure.
    const benign = ['already_engaged', 'not_warm'].some((p) => (result.reason || '').startsWith(p));
    if (benign) {
      return res.status(200).json({ success: true, message: `No engagement needed: ${result.reason}.` });
    }
    if (result.reason === 'webhook_not_configured') {
      return res.status(503).json({ success: false, message: 'Speed-to-lead workflow is not configured on the server yet.' });
    }
    if (result.reason === 'lead_not_found') {
      return res.status(404).json({ success: false, message: 'Lead not found.' });
    }
    return res.status(502).json({ success: false, message: `Engagement could not be started: ${result.reason}.` });
  }

  return res.status(202).json({ success: true, message: 'Speed-to-lead engagement started.' });
});

module.exports = router;
module.exports.fireSpeedToLead = fireSpeedToLead;
