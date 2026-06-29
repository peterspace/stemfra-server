// Outbound AUTO-call guardrails (P4). Gate the lead-gen speed-to-lead auto-dialer
// so it can't call people it shouldn't. Manual "Call with AI" is staff-judgment,
// but DNC applies to it too (legal). See outreachReplySweeper + leadgenCall.
const { DateTime } = require('luxon');
const supabase = require('../config/supabase');

// Conservative pan-US safe window: 12:00–18:00 ET == 9am–6pm local in EVERY
// continental US timezone (the intersection). Stays well inside the TCPA 8am–9pm
// local limit for the whole country without needing each lead's timezone.
// TODO(P4+): derive the lead's timezone (area code / region) for a wider window.
function withinCallingHours(now = DateTime.now()) {
  const h = now.setZone('America/New_York').hour;
  return h >= 12 && h < 18;
}

function isDoNotCall(lead) {
  return lead?.do_not_call === true;
}

async function dailyCap() {
  try {
    const { data } = await supabase.from('crm_settings').select('value').eq('key', 'leadgen_daily_call_cap').maybeSingle();
    return Number(data?.value?.cap) || 50;
  } catch { return 50; }
}

// How many AUTO calls have fired today (ET day), from the activity log.
async function autoCallsToday() {
  const startOfDayUtc = DateTime.now().setZone('America/New_York').startOf('day').toUTC().toISO();
  const { count } = await supabase
    .from('activity_feed')
    .select('id', { count: 'exact', head: true })
    .eq('action', 'lead_call_initiated')
    .filter('details->>trigger', 'eq', 'auto_speed_to_lead')
    .gte('created_at', startOfDayUtc);
  return count || 0;
}

async function underDailyCap() {
  return (await autoCallsToday()) < (await dailyCap());
}

// Master gate for an AUTO call. Returns { ok, reason }.
async function canAutoCall(lead, now = DateTime.now()) {
  if (isDoNotCall(lead)) return { ok: false, reason: 'do_not_call' };
  if (!withinCallingHours(now)) return { ok: false, reason: 'outside_hours' };
  if (!(await underDailyCap())) return { ok: false, reason: 'daily_cap' };
  return { ok: true };
}

module.exports = { withinCallingHours, isDoNotCall, autoCallsToday, underDailyCap, canAutoCall };
