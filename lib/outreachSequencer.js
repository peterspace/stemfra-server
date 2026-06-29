// Follow-up sequencer (P4). Drives the multi-step cold drip after Mark's first
// email (A1, sent by send-outreach = step 1): A2 (+7d), a read-gated call (+8d,
// only if A2 was opened + not signed up), A8 (+14d), A20 breakup (+21d). Cadence
// is DB-driven (crm_settings.leadgen_sequence) so it tunes without a deploy.
//
// Stops automatically: the sweep only touches leads still in `outreach_status='sent'`
// (any reply flips them to replied/bounced via the reply sweeper → drip halts),
// and it skips do_not_email / signed-up (a contact exists for the email) leads.
const crypto = require('crypto');
const supabase = require('../config/supabase');
const gmail = require('./gmailOutreach');
const leadgenCall = require('./leadgenCall');
const { canAutoCall } = require('./callGuardrails');
const { fillOutreachLinks } = require('./demoLinks');

const BATCH = 100;
const MARK_EMAIL = process.env.MARK_EMAIL || 'mark@stemfra.com';
const DAY = 86400000;

async function getSequence() {
  const { data } = await supabase.from('crm_settings').select('value').eq('key', 'leadgen_sequence').maybeSingle();
  return data?.value || { campaign_days: 30, daily_email_cap: 200, steps: [] };
}
async function sequencerEnabled() {
  try {
    const { data } = await supabase.from('crm_settings').select('value').eq('key', 'leadgen_sequencer').maybeSingle();
    return !!data?.value?.enabled;
  } catch { return false; }
}

// PURE: the next step that is due for a lead, or null. 'sent' implies step 1 (A1)
// is done, so a step-0 lead is treated as step 1. Day offsets are cumulative from
// the A1 send (outreach_sent_at).
function nextDueStep(lead, sequence, now = new Date()) {
  const anchor = lead.outreach_sent_at ? new Date(lead.outreach_sent_at).getTime() : null;
  if (!anchor) return null;
  const effective = Math.max(lead.outreach_step || 0, 1);
  const next = (sequence.steps || []).filter((s) => s.step > effective).sort((a, b) => a.step - b.step)[0];
  if (!next) return null;
  return now.getTime() >= anchor + next.day * DAY ? next : null;
}

// Has this lead become a customer? (onboarding creates a contact with auth_user_id.)
async function isSignedUp(email) {
  if (!email) return false;
  const { data } = await supabase.from('contacts').select('id').eq('email', String(email).toLowerCase()).not('auth_user_id', 'is', null).limit(1).maybeSingle();
  return !!data;
}

async function emailsSentToday() {
  const since = new Date(Date.now() - DAY).toISOString(); // rolling 24h is plenty for a daily cap
  const { count } = await supabase.from('activity_feed').select('id', { count: 'exact', head: true })
    .eq('action', 'lead_followup_email').gte('created_at', since);
  return count || 0;
}

function renderMergeFields(text, lead) {
  const first = lead.first_name || (lead.contact_name ? String(lead.contact_name).split(/\s+/)[0] : '') || 'there';
  const biz = lead.company_name || 'your business';
  let out = String(text || '')
    .replace(/\{\{\s*first_name\s*\}\}/g, first)
    .replace(/\{\{\s*business_name\s*\}\}/g, biz)
    .replace(/\{\{\s*sender_name\s*\}\}/g, 'Mark')
    .replace(/\{\{\s*sender_phone\s*\}\}/g, process.env.VOICE_PHONE_NUMBER || '')
    .replace(/\{\{\s*sender_email\s*\}\}/g, MARK_EMAIL);
  out = fillOutreachLinks(out, { templateSlug: lead.template_slug });
  return out.replace(/\{\{[^}]+\}\}/g, '').trim(); // drop any unknown merge fields
}

async function logActivity(lead, action, details) {
  await supabase.from('activity_feed').insert([{
    entity_type: 'lead', entity_id: lead.id, action, details: { ...details, company_name: lead.company_name || null },
    created_by: lead.outreach_sent_by || null,
  }]).then(() => {}, () => {});
}

async function sendEmailStep(lead, step) {
  const { data: tpl } = await supabase.from('email_templates').select('code, subject, body').eq('code', step.code).eq('is_active', true).maybeSingle();
  if (!tpl) { await logActivity(lead, 'lead_followup_skipped', { step: step.step, reason: `template ${step.code} missing` }); return false; }

  const base = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  const token = base ? crypto.randomBytes(16).toString('hex') : null;
  const pixelUrl = token ? `${base}/api/leadgen/o/${token}.gif` : null;

  let body = renderMergeFields(tpl.body, lead);
  const sig = `\n\nMark\nStemfra\n${process.env.VOICE_PHONE_NUMBER || ''} · ${MARK_EMAIL}`;
  if (!body.includes(MARK_EMAIL)) body += sig;
  const subject = renderMergeFields(tpl.subject, lead) || `A quick follow-up for ${lead.company_name || 'your business'}`;

  const { messageId } = await gmail.sendAsRep({ repEmail: MARK_EMAIL, repName: 'Mark', to: lead.email, subject, text: body, pixelUrl });
  const nowIso = new Date().toISOString();
  // Repoint open-tracking to THIS email so "read" means the latest step was read.
  await supabase.from('leads').update({
    outreach_step: step.step, outreach_last_step_at: nowIso,
    outreach_track_token: token, outreach_opened_at: null, outreach_last_opened_at: null, outreach_open_count: 0,
    outreach_message_id: messageId, last_activity_at: nowIso,
  }).eq('id', lead.id);
  await logActivity(lead, 'lead_followup_email', { step: step.step, code: step.code });
  return true;
}

async function doCallStep(lead, step) {
  const opened = !!lead.outreach_opened_at;
  // Read-gate: if the prior email wasn't opened, skip the call (advance past it).
  if (step.require_opened && !opened) {
    await supabase.from('leads').update({ outreach_step: step.step }).eq('id', lead.id);
    await logActivity(lead, 'lead_followup_skipped', { step: step.step, reason: 'unread_no_call' });
    return;
  }
  const guard = await canAutoCall(lead);
  if (!guard.ok) {
    // DNC → advance (never call). Outside-hours/cap → leave step to retry next sweep.
    if (guard.reason === 'do_not_call') {
      await supabase.from('leads').update({ outreach_step: step.step }).eq('id', lead.id);
      await logActivity(lead, 'lead_followup_skipped', { step: step.step, reason: 'do_not_call' });
    }
    return;
  }
  if (!leadgenCall.isConfigured() || !leadgenCall.toE164(lead.phone, lead.phone_country)) {
    await supabase.from('leads').update({ outreach_step: step.step }).eq('id', lead.id);
    await logActivity(lead, 'lead_followup_skipped', { step: step.step, reason: 'not_callable' });
    return;
  }
  try {
    const { callSid, to } = await leadgenCall.placeAiCall(lead);
    await supabase.from('leads').update({ outreach_step: step.step, outreach_last_step_at: new Date().toISOString() }).eq('id', lead.id);
    await logActivity(lead, 'lead_call_initiated', { step: step.step, call_sid: callSid, to, trigger: 'sequencer' });
    console.log(`[sequencer] read-gated call → lead ${lead.id} (${callSid})`);
  } catch (e) {
    console.error('[sequencer] call failed for lead', lead.id, '—', e.message);
  }
}

async function sweepOnce() {
  if (!gmail.isConfigured() || !(await sequencerEnabled())) return;
  const sequence = await getSequence();
  if (!sequence.steps?.length) return;

  const since = new Date(Date.now() - (sequence.campaign_days || 30) * DAY).toISOString();
  const { data: leads } = await supabase.from('leads')
    .select('id, email, company_name, contact_name, first_name, template_slug, phone, phone_country, do_not_call, do_not_email, outreach_status, outreach_step, outreach_sent_at, outreach_last_step_at, outreach_opened_at, outreach_thread_id, outreach_sent_by')
    .eq('outreach_status', 'sent').eq('do_not_email', false)
    .gte('outreach_sent_at', since).limit(BATCH);
  if (!leads?.length) return;

  let sentCount = await emailsSentToday();
  const cap = sequence.daily_email_cap || 200;

  for (const lead of leads) {
    const step = nextDueStep(lead, sequence, new Date());
    if (!step) continue;

    if (await isSignedUp(lead.email)) {           // became a customer → stop
      await supabase.from('leads').update({ stage: 'won', last_activity_at: new Date().toISOString() }).eq('id', lead.id);
      await logActivity(lead, 'lead_converted', { via: 'signup' });
      continue;
    }

    if (step.kind === 'call') { await doCallStep(lead, step); continue; }

    // email
    if (sentCount >= cap) continue;               // daily cap — defer to next sweep
    try { if (await sendEmailStep(lead, step)) sentCount++; }
    catch (e) { console.error('[sequencer] email step failed for lead', lead.id, '—', e.message); }
  }
  console.log(`[sequencer] swept ${leads.length} lead(s)`);
}

function startOutreachSequencer({ intervalMs = 3600000 } = {}) {
  if (!gmail.isConfigured()) { console.log('✓ Outreach sequencer idle (Google service account not configured)'); return null; }
  setTimeout(() => sweepOnce().catch(() => {}), 45000);
  const t = setInterval(() => sweepOnce().catch(() => {}), intervalMs);
  console.log(`✓ Outreach sequencer running every ${Math.round(intervalMs / 60000)}min`);
  return t;
}

module.exports = { sweepOnce, startOutreachSequencer, nextDueStep, renderMergeFields, isSignedUp };
