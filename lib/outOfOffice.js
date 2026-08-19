// Out-of-office periods for the Stemfra TEAM (2026-08-19, Peter travelling
// Aug 19–27). ONE setting honored by every "talk to a human" surface:
//   - setup-call booking (lib/setupCall.js): no slots on OOO days, /book-a-call
//     shows the notice + first available day
//   - Mark's voice calls (controllers/voiceController.js): no live transfer, no
//     same-day callback promise; he says when the team is back
// Stored in crm_settings.out_of_office = { periods: [{ from:'YYYY-MM-DD',
// to:'YYYY-MM-DD', note }] } (ET dates, inclusive). Edited in the CRM → Setup
// Calls → "Out of office". Cached 60s.
const supabase = require('../config/supabase');
const { DateTime } = require('luxon');

const TZ = 'America/New_York';
let cache = { at: 0, periods: [] };

async function periods() {
  if (Date.now() - cache.at < 60_000) return cache.periods;
  try {
    const { data } = await supabase.from('crm_settings').select('value').eq('key', 'out_of_office').maybeSingle();
    const list = Array.isArray(data?.value?.periods) ? data.value.periods : [];
    cache = { at: Date.now(), periods: list.filter((p) => p && p.from && p.to) };
  } catch { cache = { at: Date.now(), periods: [] }; }
  return cache.periods;
}
function invalidate() { cache.at = 0; }

/** The OOO period covering `dateStr` (YYYY-MM-DD, ET) or `now`, else null. */
async function periodFor(dateStr) {
  const d = dateStr || DateTime.now().setZone(TZ).toFormat('yyyy-MM-dd');
  for (const p of await periods()) if (p.from <= d && d <= p.to) return p;
  return null;
}
async function isOutOfOffice(dateStr) { return !!(await periodFor(dateStr)); }

/** Current or next upcoming period (for notices), else null. */
async function currentOrNext() {
  const today = DateTime.now().setZone(TZ).toFormat('yyyy-MM-dd');
  const list = (await periods()).filter((p) => p.to >= today).sort((a, b) => a.from.localeCompare(b.from));
  return list[0] || null;
}
const fmt = (d) => DateTime.fromISO(d, { zone: TZ }).toFormat('MMMM d');
function describe(p) {
  if (!p) return null;
  return `${fmt(p.from)} to ${fmt(p.to)}`;
}

module.exports = { periods, periodFor, isOutOfOffice, currentOrNext, describe, invalidate, TZ };
