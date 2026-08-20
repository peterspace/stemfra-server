// Outbound AI-call sweeper (2026-08-20, Peter: "Mark starts calling tomorrow").
// The phone-only half of the split funnel: Google-Maps leads with a phone but
// NO email never enter the email sequence — Mark's call IS touch 1. Every
// sweep (5 min) this places at most ONE call to the next eligible lead, so
// calls stay sequential and reviewable.
//
// Eligible lead: email IS NULL · phone present · not do_not_call · not test ·
// review_status needs_review/approved · never called by this sweeper
// (first_touch_at IS NULL — the sweeper's own stamp) · local time inside the
// call window (default 11:00–18:59 in the LEAD's timezone, state → zone).
//
// Gates: crm_settings.leadgen_auto_call.enabled (the CRM master switch) ·
// daily cap crm_settings.leadgen_call_daily_cap (default 15) · prod-only
// (OUTBOUND_CALL_SWEEPER_DEV=true opts a dev box in) · Twilio configured.
// Voicemail/no-answer are handled by the existing AMD webhooks in
// lib/leadgenCall.js; the call outcome lands on the lead via finalizeCall.
const supabase = require('../config/supabase');
const leadgenCall = require('./leadgenCall');
const { timezoneForLead } = require('./leadTimezone');

const CALL_START_HOUR = Number(process.env.LEADGEN_CALL_START_HOUR || 11);
const CALL_END_HOUR = Number(process.env.LEADGEN_CALL_END_HOUR || 19); // exclusive

async function setting(key) {
  const { data } = await supabase.from('crm_settings').select('value').eq('key', key).maybeSingle();
  return data?.value ?? null;
}

function localHour(tz) {
  try { return Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false }).format(new Date())); }
  catch { return new Date().getUTCHours() - 5; }
}

async function callsPlacedToday() {
  const start = new Date(); start.setUTCHours(0, 0, 0, 0);
  const { count } = await supabase.from('leads')
    .select('id', { count: 'exact', head: true })
    .is('email', null)
    .gte('first_touch_at', start.toISOString());
  return count || 0;
}

async function sweepOnce() {
  if (process.env.NODE_ENV !== 'production' && process.env.OUTBOUND_CALL_SWEEPER_DEV !== 'true') return;
  if (!leadgenCall.isConfigured()) return;
  const auto = await setting('leadgen_auto_call');
  if (!auto?.enabled) return;

  const capRaw = await setting('leadgen_call_daily_cap');
  const cap = Number(capRaw?.value ?? capRaw ?? 15) || 15;
  const placed = await callsPlacedToday();
  if (placed >= cap) return;

  // Highest score first; buying-trigger leads naturally float up via score.
  const { data: leads } = await supabase.from('leads')
    .select('*')
    .is('email', null)
    .not('phone', 'is', null)
    .eq('do_not_call', false)
    .eq('is_test', false)
    .in('review_status', ['needs_review', 'approved'])
    .is('first_touch_at', null)
    .order('lead_score', { ascending: false, nullsFirst: false })
    .limit(25);

  for (const lead of leads || []) {
    if (!leadgenCall.toE164(lead.phone, lead.phone_country)) continue;
    const hour = localHour(timezoneForLead(lead));
    if (hour < CALL_START_HOUR || hour >= CALL_END_HOUR) continue;
    // Stamp BEFORE dialing so a crash mid-call never redials the same lead.
    const nowIso = new Date().toISOString();
    const { error } = await supabase.from('leads')
      .update({ first_touch_at: nowIso, outreach_last_step_at: nowIso, review_status: 'approved', last_activity_at: nowIso })
      .eq('id', lead.id).is('first_touch_at', null);
    if (error) continue;
    try {
      const { callSid } = await leadgenCall.placeAiCall(lead, { reason: 'Automated first-contact call (phone-only cohort): introduce the built website, then text the link or capture an email.' });
      console.log(`[call-sweeper] ☎ ${lead.company_name || lead.id} (${lead.phone}) — ${callSid} (${placed + 1}/${cap} today)`);
    } catch (e) {
      console.error('[call-sweeper] place failed:', lead.company_name, e.message);
    }
    break; // one call per sweep — sequential, reviewable pacing
  }
}

function startOutboundCallSweeper({ intervalMs = 5 * 60000 } = {}) {
  setTimeout(() => sweepOnce().catch(() => {}), 60000);
  const t = setInterval(() => sweepOnce().catch(() => {}), intervalMs);
  t.unref?.();
  console.log(`✓ Outbound call sweeper running every ${Math.round(intervalMs / 60000)}min (window ${CALL_START_HOUR}:00–${CALL_END_HOUR}:00 local)`);
  return t;
}

module.exports = { sweepOnce, startOutboundCallSweeper };
