// Recipient-local send times (2026-08-19). Leads carry a US state (leads.region
// = code like 'NY', sometimes a name); map it to an IANA zone so the outreach
// sequencer can send "at 11:00 THEIR time". Multi-zone states use the zone
// where most of the population lives. Fallback: America/New_York.
const STATE_TZ = {
  AL: 'America/Chicago', AK: 'America/Anchorage', AZ: 'America/Phoenix', AR: 'America/Chicago', CA: 'America/Los_Angeles',
  CO: 'America/Denver', CT: 'America/New_York', DE: 'America/New_York', DC: 'America/New_York', FL: 'America/New_York',
  GA: 'America/New_York', HI: 'Pacific/Honolulu', ID: 'America/Boise', IL: 'America/Chicago', IN: 'America/Indiana/Indianapolis',
  IA: 'America/Chicago', KS: 'America/Chicago', KY: 'America/New_York', LA: 'America/Chicago', ME: 'America/New_York',
  MD: 'America/New_York', MA: 'America/New_York', MI: 'America/Detroit', MN: 'America/Chicago', MS: 'America/Chicago',
  MO: 'America/Chicago', MT: 'America/Denver', NE: 'America/Chicago', NV: 'America/Los_Angeles', NH: 'America/New_York',
  NJ: 'America/New_York', NM: 'America/Denver', NY: 'America/New_York', NC: 'America/New_York', ND: 'America/Chicago',
  OH: 'America/New_York', OK: 'America/Chicago', OR: 'America/Los_Angeles', PA: 'America/New_York', RI: 'America/New_York',
  SC: 'America/New_York', SD: 'America/Chicago', TN: 'America/Chicago', TX: 'America/Chicago', UT: 'America/Denver',
  VT: 'America/New_York', VA: 'America/New_York', WA: 'America/Los_Angeles', WV: 'America/New_York', WI: 'America/Chicago', WY: 'America/Denver',
};
const NAME_TO_CODE = {
  alabama:'AL',alaska:'AK',arizona:'AZ',arkansas:'AR',california:'CA',colorado:'CO',connecticut:'CT',delaware:'DE','district of columbia':'DC',florida:'FL',georgia:'GA',hawaii:'HI',idaho:'ID',illinois:'IL',indiana:'IN',iowa:'IA',kansas:'KS',kentucky:'KY',louisiana:'LA',maine:'ME',maryland:'MD',massachusetts:'MA',michigan:'MI',minnesota:'MN',mississippi:'MS',missouri:'MO',montana:'MT',nebraska:'NE',nevada:'NV','new hampshire':'NH','new jersey':'NJ','new mexico':'NM','new york':'NY','north carolina':'NC','north dakota':'ND',ohio:'OH',oklahoma:'OK',oregon:'OR',pennsylvania:'PA','rhode island':'RI','south carolina':'SC','south dakota':'SD',tennessee:'TN',texas:'TX',utah:'UT',vermont:'VT',virginia:'VA',washington:'WA','west virginia':'WV',wisconsin:'WI',wyoming:'WY',
};
const DEFAULT_TZ = 'America/New_York';

function stateCodeOf(lead) {
  const raw = String(lead?.region || lead?.state || '').trim();
  if (!raw) return null;
  if (/^[A-Za-z]{2}$/.test(raw)) return raw.toUpperCase();
  return NAME_TO_CODE[raw.toLowerCase()] || null;
}
function timezoneForLead(lead) {
  const code = stateCodeOf(lead);
  return (code && STATE_TZ[code]) || DEFAULT_TZ;
}
/** Local hour (0-23) right now (or at `at`) in the lead's zone. */
function localHour(tz, at = new Date()) {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false }).format(at)) % 24;
}
/** The next instant when it is `hour:00` in `tz` (today if still ahead, else tomorrow). */
function nextLocalTime(tz, hour, from = new Date()) {
  // Walk forward hour by hour until the local hour matches, then snap to :00.
  const t = new Date(from.getTime());
  t.setUTCMinutes(0, 0, 0);
  for (let i = 0; i < 48; i++) {
    if (t > from && localHour(tz, t) === hour) return t;
    t.setTime(t.getTime() + 3600_000);
  }
  return new Date(from.getTime() + 3600_000);
}

module.exports = { STATE_TZ, DEFAULT_TZ, timezoneForLead, localHour, nextLocalTime, stateCodeOf };
