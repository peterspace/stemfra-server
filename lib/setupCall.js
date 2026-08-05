// Setup-call booking core (P12 §3). A VIDEO setup call (Google Meet) with staff,
// booked from the marketing site. Availability = a configured weekly window MINUS
// the host's real Google free/busy MINUS already-booked setup_calls. Booking
// creates a Meet event (inviting the prospect + staff) and records a setup_calls
// row. Reusable Calendar/Meet plumbing lives in lib/googleCalendar.js.
const supabase = require('../config/supabase');
const { DateTime } = require('luxon');
const gc = require('./googleCalendar');

const CONFIG = {
  timeZone: 'America/New_York',
  slotMinutes: 45,
  // Mon–Fri afternoons (Peter's choice). luxon weekday: 1=Mon … 7=Sun.
  windowStartMin: 12 * 60, // 12:00pm
  windowEndMin: 17 * 60,   // 5:00pm
  leadDays: 21,            // how far ahead bookable
  minLeadHours: 2,         // minimum notice
};

function attendees() {
  return (process.env.SETUP_CALL_ATTENDEES || '').split(',').map(s => s.trim()).filter(Boolean);
}
function busyEmails() {
  const list = (process.env.SETUP_CALL_BUSY_EMAILS || '').split(',').map(s => s.trim()).filter(Boolean);
  return list.length ? list : [gc.hostEmail()].filter(Boolean);
}

function isConfigured() { return gc.isConfigured(); }

function publicConfig() {
  return {
    configured: isConfigured(),
    timeZone: CONFIG.timeZone,
    slotMinutes: CONFIG.slotMinutes,
    window: 'Mon–Fri, 12:00–5:00pm ET',
    leadDays: CONFIG.leadDays,
  };
}

// Candidate slot start-minutes within the window (slotEnd ≤ windowEnd).
function candidateStartMins() {
  const out = [];
  for (let m = CONFIG.windowStartMin; m + CONFIG.slotMinutes <= CONFIG.windowEndMin; m += CONFIG.slotMinutes) out.push(m);
  return out;
}
const overlaps = (aS, aE, bS, bE) => aS < bE && bS < aE;

// Available 'HH:mm' (ET) slots for a single date (YYYY-MM-DD).
async function getDaySlots(dateStr) {
  if (!isConfigured()) return [];
  const day = DateTime.fromISO(dateStr, { zone: CONFIG.timeZone });
  if (!day.isValid || day.weekday > 5) return []; // Mon–Fri only

  const now = DateTime.now().setZone(CONFIG.timeZone);
  const minStart = now.plus({ hours: CONFIG.minLeadHours });
  if (day.startOf('day') > now.plus({ days: CONFIG.leadDays }).startOf('day')) return [];
  if (day.startOf('day') < now.startOf('day')) return [];

  const winStart = day.startOf('day').plus({ minutes: CONFIG.windowStartMin });
  const winEnd = day.startOf('day').plus({ minutes: CONFIG.windowEndMin });

  const [gBusy, existing] = await Promise.all([
    gc.queryFreeBusy({
      timeMin: winStart.toISO(), timeMax: winEnd.toISO(),
      calendarIds: [...new Set([gc.hostEmail(), ...busyEmails()])],
    }).catch(() => []),
    supabase.from('setup_calls').select('starts_at, ends_at').neq('status', 'canceled')
      .gte('starts_at', winStart.toISO()).lt('starts_at', winEnd.toISO()),
  ]);
  const busy = [
    ...(gBusy || []).map(b => [DateTime.fromISO(b.start).toMillis(), DateTime.fromISO(b.end).toMillis()]),
    ...((existing.data) || []).map(r => [DateTime.fromISO(r.starts_at).toMillis(), DateTime.fromISO(r.ends_at).toMillis()]),
  ];

  const slots = [];
  for (const m of candidateStartMins()) {
    const s = day.startOf('day').plus({ minutes: m });
    if (s < minStart) continue;
    const e = s.plus({ minutes: CONFIG.slotMinutes });
    if (busy.some(([bs, be]) => overlaps(s.toMillis(), e.toMillis(), bs, be))) continue;
    slots.push(s.toFormat('HH:mm'));
  }
  return slots;
}

// Dates in a month (year, month 1-12) that have ≥1 open slot. Skips weekends /
// out-of-window days without a free/busy call.
async function getMonthDates(year, month) {
  if (!isConfigured()) return [];
  const first = DateTime.fromObject({ year, month, day: 1 }, { zone: CONFIG.timeZone });
  if (!first.isValid) return [];
  const now = DateTime.now().setZone(CONFIG.timeZone);
  const maxDay = now.plus({ days: CONFIG.leadDays }).startOf('day');
  const out = [];
  for (let d = 1; d <= first.daysInMonth; d++) {
    const day = first.set({ day: d });
    if (day.weekday > 5) continue;
    if (day.startOf('day') < now.startOf('day') || day.startOf('day') > maxDay) continue;
    const slots = await getDaySlots(day.toFormat('yyyy-MM-dd'));
    if (slots.length) out.push(day.toFormat('yyyy-MM-dd'));
  }
  return out;
}

// Book a slot: re-check availability, create the Meet event, record the row.
async function book({ name, email, phone, businessName, vertical, notes, date, time, leadId }) {
  if (!isConfigured()) return { ok: false, code: 503, message: 'Setup-call booking is not configured yet.' };
  if (!name || !email || !date || !time) return { ok: false, code: 400, message: 'Please fill in your name, email, and a time.' };

  const start = DateTime.fromISO(`${date}T${time}`, { zone: CONFIG.timeZone });
  if (!start.isValid) return { ok: false, code: 400, message: 'Invalid date/time.' };
  const end = start.plus({ minutes: CONFIG.slotMinutes });

  // Re-check the slot is still open (guards against a race between two bookers).
  const slots = await getDaySlots(date);
  if (!slots.includes(time)) return { ok: false, code: 409, message: 'That time was just taken — please pick another.' };

  const who = businessName ? `${name} · ${businessName}` : name;
  const ev = await gc.createEventWithMeet({
    summary: `Stemfra setup call — ${who}`,
    description: [
      `Website setup call with ${name}.`,
      businessName ? `Business: ${businessName}` : '',
      vertical ? `Vertical: ${vertical}` : '',
      phone ? `Phone: ${phone}` : '',
      `Email: ${email}`,
      notes ? `\nNotes: ${notes}` : '',
    ].filter(Boolean).join('\n'),
    startIso: start.toISO(), endIso: end.toISO(), timeZone: CONFIG.timeZone,
    attendees: [{ email, name }, ...attendees().map(e => ({ email: e }))],
  });

  const { data: row, error } = await supabase.from('setup_calls').insert({
    lead_id: leadId || null,
    prospect_name: name, prospect_email: email, prospect_phone: phone || null,
    business_name: businessName || null, vertical: vertical || null, notes: notes || null,
    starts_at: start.toISO(), ends_at: end.toISO(), time_zone: CONFIG.timeZone,
    status: 'booked', google_event_id: ev.eventId, meet_link: ev.meetLink, google_html_link: ev.htmlLink,
    metadata: { source: 'marketing_site' },
  }).select('*').single();
  if (error) {
    // Roll back the calendar event so we don't strand a ghost booking.
    try { await gc.deleteEvent({ eventId: ev.eventId }); } catch { /* best effort */ }
    return { ok: false, code: 500, message: error.message };
  }

  // Best-effort CRM activity if this came from a known lead.
  if (leadId) {
    try {
      await supabase.from('activity_feed').insert([{
        entity_type: 'lead', entity_id: leadId, action: 'setup_call_booked',
        details: { starts_at: start.toISO(), meet_link: ev.meetLink, setup_call_id: row.id },
      }]);
    } catch { /* best effort */ }
  }

  return { ok: true, setupCallId: row.id, startsAt: start.toISO(), meetLink: ev.meetLink, timeZone: CONFIG.timeZone };
}

module.exports = { isConfigured, publicConfig, getDaySlots, getMonthDates, book, CONFIG };
