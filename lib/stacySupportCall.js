// stacySupportCall.js — Stacy's in-chat support-call booking tool (2026-09-02,
// the "book a meeting from the CMS" ask). Mirrors the Front Desk booking-tool
// pattern (lib/frontdeskBooking.js): the AGENT emits an intent object, the
// SERVER grounds it against the real support-site calendar (bookingController
// cores) and returns { note, card, quickReplies } — the note re-invokes the
// workflow once so the reply reflects real availability; the card/chips render
// in the Stacy panel. The FINAL booking is NOT placed here: the panel's
// confirm card books through the same public /api/site-bookings path the CMS
// Support page uses (deterministic, no server-side confirm state).
const { computeAvailability } = require('../controllers/bookingController');
const { loadSupportCallConfig } = require('../controllers/cms/supportController');

const ALLOWED = ['live', 'previewing'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

function pad(n) { return String(n).padStart(2, '0'); }
function fmtDate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

/** Loose service match on the agent's `topic` ("consultation", "billing", …). */
function pickService(services, topic) {
  const t = String(topic || '').toLowerCase().trim();
  if (t) {
    const hit = services.find((s) => s.name.toLowerCase().includes(t) || t.includes(s.category));
    if (hit) return hit;
  }
  return services[0];
}

/**
 * call = { topic?, date? (YYYY-MM-DD), time? (HH:MM, support-site wall clock) }
 * Returns { note, card, quickReplies } — any may be null/empty.
 */
async function runSupportCallTool(call) {
  const cfg = await loadSupportCallConfig();
  if (!cfg) {
    return { note: 'SYSTEM: support calls are not available right now — apologise and suggest the Support page.', card: null, quickReplies: [] };
  }
  const service = pickService(cfg.services, call.topic);
  const base = { siteId: cfg.siteId, teamMemberId: cfg.teamMemberId, serviceId: service.id, allowedStatuses: ALLOWED };

  // No usable date → offer the next available days as chips.
  const date = DATE_RE.test(String(call.date || '')) ? call.date : null;
  if (!date) {
    const openDays = [];
    const probe = new Date();
    for (let i = 0; i < 10 && openDays.length < 5; i++) {
      probe.setDate(probe.getDate() + 1);
      const ds = fmtDate(probe);
      try {
        const r = await computeAvailability({ ...base, date: ds });
        if (r.ok && r.slots.length) openDays.push(ds);
      } catch { /* skip the day */ }
    }
    if (!openDays.length) {
      return { note: 'SYSTEM: no open call days in the next 10 days — apologise and suggest the Support page request form instead.', card: null, quickReplies: [] };
    }
    const pretty = openDays.map((d) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }));
    return {
      note: `SYSTEM (real calendar): the next available days for a ${service.name} are: ${openDays.map((d, i) => `${d} (${pretty[i]})`).join(', ')}. Ask the owner which day works; when they pick one, emit call with that date.`,
      card: null,
      quickReplies: pretty,
    };
  }

  // Date but no time → real slots for that day as chips.
  const time = TIME_RE.test(String(call.time || '')) ? call.time : null;
  const avail = await computeAvailability({ ...base, date });
  if (!avail.ok || !avail.slots.length) {
    return { note: `SYSTEM (real calendar): ${date} has NO free times for a ${service.name}. Tell the owner and ask for another day (emit call with the new date).`, card: null, quickReplies: [] };
  }
  if (!time) {
    const shown = avail.slots.slice(0, 6);
    return {
      note: `SYSTEM (real calendar): free times on ${date} (${cfg.timeZone} wall clock): ${shown.join(', ')}${avail.slots.length > 6 ? ' and more' : ''}. Ask the owner to pick one; when they do, emit call with date AND time.`,
      card: null,
      quickReplies: shown,
    };
  }

  // Date + time → validate and hand the panel a confirm card.
  if (!avail.slots.includes(time)) {
    const shown = avail.slots.slice(0, 6);
    return {
      note: `SYSTEM (real calendar): ${time} on ${date} is TAKEN. Free times: ${shown.join(', ')}. Ask the owner to pick another (emit call with the new time).`,
      card: null,
      quickReplies: shown,
    };
  }
  return {
    note: `SYSTEM: ${time} on ${date} is available for a ${service.name}. Tell the owner to confirm the booking in the card shown below your reply (do not claim it is booked yet).`,
    card: {
      type: 'call_confirm',
      siteId: cfg.siteId,
      teamMemberId: cfg.teamMemberId,
      serviceId: service.id,
      serviceName: service.name,
      durationMinutes: service.durationMinutes,
      date,
      time,
      timeZone: cfg.timeZone,
    },
    quickReplies: [],
  };
}

module.exports = { runSupportCallTool };
