// Outreach reply sweeper — Phase 2 of the lead-gen send → track → escalate middle.
// Polls the Gmail threads of recently-sent outreach emails; when a prospect
// REPLIES, it flips the lead WARM (outreach_status='replied' + outreach_replied_at)
// so Phase 3 (the outbound voice follow-up) can pick it up. Bounce notices are
// marked 'bounced'. Polling (not Gmail push/Pub-Sub) is plenty for this low volume.
const { DateTime } = require('luxon');
const supabase = require('../config/supabase');
const gmail = require('./gmailOutreach');
const leadgenCall = require('./leadgenCall');

const WINDOW_DAYS = 14; // stop polling a lead this long after send with no reply
const BATCH = 50;

// Auto speed-to-lead: when ON, a freshly-replied lead is called automatically
// (gated to US business hours). The manual "Call with AI" button works any time.
async function autoCallEnabled() {
  try {
    const { data } = await supabase.from('crm_settings').select('value').eq('key', 'leadgen_auto_call').maybeSingle();
    return !!data?.value?.enabled;
  } catch { return false; }
}
function withinCallingHours() {
  const h = DateTime.now().setZone('America/New_York').hour;   // 9am–6pm ET
  return h >= 9 && h < 18;
}

async function logReply(lead, kind) {
  try {
    await supabase.from('activity_feed').insert([{
      entity_type: 'lead',
      entity_id:   lead.id,
      action:      kind === 'bounced' ? 'lead_bounced' : 'lead_replied',
      details:     { company_name: lead.company_name || null, email: lead.email || null },
      created_by:  lead.outreach_sent_by || null,
    }]);
  } catch { /* best-effort, never block the sweep */ }
}

async function sweepOnce() {
  if (!gmail.isConfigured()) return;
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 3600 * 1000).toISOString();
  const { data: leads, error } = await supabase
    .from('leads')
    .select('id, company_name, contact_name, email, phone, phone_country, pain_point_bucket, qualification, outreach_thread_id, outreach_sent_by, outreach_sent_at')
    .eq('outreach_status', 'sent')
    .gte('outreach_sent_at', since)
    .not('outreach_thread_id', 'is', null)
    .limit(BATCH);
  if (error || !leads?.length) return;

  // All outreach is sent AS Mark, so every reply lands in mark@'s inbox.
  const MARK_EMAIL = process.env.MARK_EMAIL || 'mark@stemfra.com';
  const autoCall = await autoCallEnabled();
  let flipped = 0;
  for (const lead of leads) {
    let reply;
    try {
      reply = await gmail.checkThreadForReply({ repEmail: MARK_EMAIL, threadId: lead.outreach_thread_id });
    } catch {
      continue; // transient Gmail error — retry next sweep
    }
    if (!reply) continue;

    const status = reply.bounced ? 'bounced' : 'replied';
    await supabase.from('leads').update({
      outreach_status:     status,
      outreach_replied_at: new Date().toISOString(),
      outreach_reply_text: status === 'replied' ? (reply.snippet || null) : null,
      last_activity_at:    new Date().toISOString(),
    }).eq('id', lead.id);
    await logReply(lead, status);
    flipped++;

    // Auto speed-to-lead: a real reply → call them now (if enabled + in hours + callable).
    if (status === 'replied' && autoCall && withinCallingHours()
        && leadgenCall.isConfigured() && leadgenCall.toE164(lead.phone, lead.phone_country)) {
      try {
        const { callSid, to } = await leadgenCall.placeAiCall(lead);
        await supabase.from('activity_feed').insert([{
          entity_type: 'lead', entity_id: lead.id, action: 'lead_call_initiated',
          details: { call_sid: callSid, to, company_name: lead.company_name || null, trigger: 'auto_speed_to_lead' },
          created_by: lead.outreach_sent_by || null,
        }]).then(() => {}, () => {});
        console.log(`[outreach] auto-called replied lead ${lead.id} → ${callSid}`);
      } catch (e) {
        console.error('[outreach] auto-call failed for lead', lead.id, '—', e.message);
      }
    }
  }
  if (flipped) console.log(`[outreach] reply sweep — flipped ${flipped} lead(s)`);
}

function startOutreachReplySweeper({ intervalMs = 180000 } = {}) {
  if (!gmail.isConfigured()) {
    console.log('✓ Outreach reply sweeper idle (Google service account not configured)');
    return null;
  }
  setTimeout(() => sweepOnce().catch(() => {}), 15000);          // shortly after boot
  const t = setInterval(() => sweepOnce().catch(() => {}), intervalMs);
  console.log(`✓ Outreach reply sweeper running every ${Math.round(intervalMs / 1000)}s`);
  return t;
}

module.exports = { sweepOnce, startOutreachReplySweeper };
