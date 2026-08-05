// Membership period math (P14). Anniversary-based: advance a period end by one
// plan interval FROM a base date, so contiguous periods keep the anniversary
// even when a payment is confirmed late. luxon handles month-end correctly
// (e.g. Jan 31 + 1 month → Feb 28/29).
const { DateTime } = require('luxon');

const UNIT = { month: 'months', year: 'years', week: 'weeks' };

// Returns an ISO string `count` intervals after baseIso.
function addInterval(baseIso, interval, count = 1) {
  const unit = UNIT[interval] || 'months';
  const n = Math.max(1, Number(count) || 1);
  return DateTime.fromISO(baseIso, { zone: 'utc' }).plus({ [unit]: n }).toUTC().toISO();
}

module.exports = { addInterval };
