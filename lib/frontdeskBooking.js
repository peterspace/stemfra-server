// Front Desk (Agent 2), F3 — in-chat booking tool (server-orchestrated).
//
// The chat agent emits a `booking` object each turn (intent, service, barber,
// date, time, customer, confirm). This module turns that into REAL action against
// the native booking engine and returns a `note` — a short system message the
// chat controller injects into the agent's NEXT turn so the agent's reply is
// grounded in real availability / a real confirmation (never invented times).
//
// Policy (Peter, 2026-06-24):
//   • Book in chat with an explicit confirm step (confirm=true only after the
//     visitor approves a summary).
//   • FREE services book directly here; PRICED services hand off to the booking
//     page so card payment stays intact — we never take payment in chat.
//
// Booking logic is reused (not duplicated) from controllers/bookingController.js
// via the exported cores; allowedStatuses includes 'previewing' so the feature
// is testable on preview sites (the public booking page stays live-only).
const supabase = require('../config/supabase');
const { DateTime } = require('luxon');
const { computeAvailability, placeBooking, listClassSessions, bookClassSession } = require('../controllers/bookingController');
const { createBookingIntent } = require('../controllers/sitePaymentsController');

const en = (v) => (v && typeof v === 'object' ? (v.en ?? '') : (v || ''));
const norm = (s) => String(s || '').trim().toLowerCase();
const ALLOWED = ['live', 'previewing'];

// Normalise an agent-emitted time to HH:mm (the model is inconsistent: "9:00" vs "09:00").
const normTime = (t) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  return h >= 0 && h <= 23 ? `${String(h).padStart(2, '0')}:${m[2]}` : null;
};

const fmtTime = (t) => {
  const [h, m] = String(t).split(':').map(Number);
  const ap = h < 12 ? 'AM' : 'PM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ap}`;
};
// Tappable time chips for the widget (capped so the chip row stays tidy).
const slotChips = (slots, n = 6) => slots.slice(0, n).map(fmtTime);
const fmtDate = (date, zone) => {
  const d = DateTime.fromISO(date, { zone });
  return d.isValid ? d.toFormat('ccc, LLL d') : date;
};

// Fuzzy name match: exact, then contains either direction.
function bestMatch(items, label, getName) {
  const q = norm(label);
  if (!q) return null;
  let m = items.find((x) => norm(getName(x)) === q);
  if (m) return m;
  m = items.find((x) => norm(getName(x)).includes(q) || q.includes(norm(getName(x))));
  return m || null;
}

const fmtSlots = (slots) => slots.slice(0, 8).map((t) => {
  const [h, m] = t.split(':').map(Number);
  const ap = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ap}`;
}).join(', ');

// Main entry. Returns { note } — a string to inject as context.booking_system_note,
// or { note: null } when there's nothing to do (the agent is still gathering and
// its own reply already asks for the missing detail).
async function runBookingTool({ site, booking, zone }) {
  if (!booking || norm(booking.intent) !== 'book') return { note: null };

  const siteId = site.id;
  const bizName = site.company?.name || 'the business';

  // Need at least a named service to act on; otherwise let the agent keep asking.
  if (!booking.service) return { note: null };

  const { data: services } = await supabase
    .from('site_services')
    .select('id, name, price_cents, duration_minutes, bookable, is_active, kind, capacity')
    .eq('site_id', siteId);
  const bookable = (services || []).filter((s) => s.is_active && s.bookable);

  const service = bestMatch(bookable, booking.service, (s) => en(s.name));
  if (!service) {
    const list = bookable.map((s) => en(s.name)).filter(Boolean).join(', ');
    return { note: `BOOKING NOTE: There's no bookable service matching "${booking.service}". Our bookable services are: ${list || '(none configured)'}. Ask the visitor which one they'd like.` };
  }
  const serviceName = en(service.name);

  // CLASS → book a spot in a scheduled session (Phase 2). Payment (if priced) is
  // handled at the confirm step inside the flow (P3).
  if (service.kind === 'class') {
    return await classBookingFlow({ site, booking, service, serviceName });
  }

  // APPOINTMENT service → gather the barber/date/time, then confirm (or pay).
  const { data: team } = await supabase
    .from('site_team_members')
    .select('id, name, is_active')
    .eq('site_id', siteId).eq('is_active', true).order('display_order');
  const activeTeam = team || [];
  if (activeTeam.length === 0) {
    return { note: `BOOKING NOTE: No bookable team members are set up, so booking isn't available right now. Suggest the visitor use the booking page or contact ${bizName} directly.` };
  }

  // Need a date (the agent normalizes to YYYY-MM-DD). If absent, let the agent ask.
  const date = typeof booking.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(booking.date.trim()) ? booking.date.trim() : null;
  if (!date) return { note: null };

  // Resolve barber: a named one must match; "any"/blank → first with availability.
  const named = booking.barber && norm(booking.barber) !== 'any' ? bestMatch(activeTeam, booking.barber, (t) => t.name) : null;
  if (booking.barber && norm(booking.barber) !== 'any' && !named) {
    const list = activeTeam.map((t) => t.name).join(', ');
    return { note: `BOOKING NOTE: We don't have a barber called "${booking.barber}". Our barbers are: ${list}. Ask which barber they'd like (or "any").` };
  }

  // Compute availability. For "any", scan team and use the first with an opening.
  const candidates = named ? [named] : activeTeam;
  let chosen = null;
  let slots = [];
  for (const member of candidates) {
    const r = await computeAvailability({ siteId, teamMemberId: member.id, serviceId: service.id, date, allowedStatuses: ALLOWED });
    if (r.ok && r.slots.length > 0) { chosen = member; slots = r.slots; break; }
    if (named) { // a specific barber was requested — report their (empty) result
      chosen = member;
      return { note: `BOOKING NOTE: ${member.name} has no openings for ${serviceName} on ${date}. Suggest another day, or a different barber. Do not invent times.` };
    }
  }
  if (!chosen) {
    return { note: `BOOKING NOTE: No barber has an opening for ${serviceName} on ${date}. Suggest the visitor try another day. Do not invent times.` };
  }
  const barberClause = named ? `with ${chosen.name}` : `with ${chosen.name} (the first barber free that day — use barber "${chosen.name}" from now on)`;

  const time = normTime(booking.time);
  const cust = booking.customer || {};
  const hasContact = (cust.email && norm(cust.email)) || (cust.phone && norm(cust.phone));
  const ready = time && cust.name && hasContact; // everything needed to book
  const timeOk = time && slots.includes(time);

  // Picked a time that isn't really open → re-offer real ones as chips.
  if (time && !timeOk) {
    return {
      note: `BOOKING NOTE: ${booking.time} isn't an available start time. Ask the visitor to pick one of the available times shown.`,
      quickReplies: slotChips(slots),
    };
  }

  const priced = (service.price_cents || 0) > 0;

  // FREE + visitor confirmed → BOOK now. (Paid services are taken via the payment
  // card → complete-booking, never a free agent-confirm.)
  if (ready && timeOk && !priced && booking.confirm === true) {
    const [firstName, ...rest] = String(cust.name).trim().split(/\s+/);
    const r = await placeBooking({
      siteId, teamMemberId: chosen.id, serviceId: service.id, date, time,
      customer: { firstName, lastName: rest.join(' ') || null, email: cust.email || null, phone: cust.phone || null },
      notes: booking.notes || null,
      allowedStatuses: ALLOWED, emailFromName: bizName,
    });
    if (r.ok) {
      return {
        note: `BOOKING CONFIRMED: Booked ${serviceName} with ${chosen.name} on ${r.booking.date} at ${r.booking.time}. Warmly confirm in ONE short sentence${cust.email ? ' and mention a confirmation email is on the way' : ''}. The details are shown on a card — don't repeat them all. Stop collecting booking details.`,
        card: { kind: 'booking_done', title: "You're booked! 🎉", lines: [serviceName, `with ${chosen.name}`, `${r.booking.date} · ${r.booking.time}`] },
      };
    }
    if (r.code === 409) {
      const fresh = await computeAvailability({ siteId, teamMemberId: chosen.id, serviceId: service.id, date, allowedStatuses: ALLOWED });
      return { note: `BOOKING NOTE: That time was just taken. Apologise and ask the visitor to pick another from the times shown.`, quickReplies: fresh.ok ? slotChips(fresh.slots) : [] };
    }
    return { note: `BOOKING NOTE: The booking couldn't be completed (${r.message}). Apologise and suggest the visitor use the booking page on this site.` };
  }

  // Everything gathered → confirm step: free shows a confirm card; paid shows a
  // payment card (Stripe) or, if the business can't take payments, a booking-page handoff.
  if (ready && timeOk) {
    return confirmStep({
      site, service, serviceName,
      lines: [serviceName, `with ${chosen.name}`, `${fmtDate(date, zone)} · ${fmtTime(time)}`, cust.name],
      pending: { kind: 'appointment', serviceId: service.id, teamMemberId: chosen.id, date, time, customer: cust },
    });
  }

  // Otherwise we have real slots — offer them as tappable chips and walk to a confirm.
  return {
    note: `AVAILABLE TIMES for ${serviceName} ${barberClause} on ${fmtDate(date, zone)}: ${fmtSlots(slots)}. Offer these real times only (they're shown as tappable chips). Once the visitor picks a time AND you have their name plus an email or phone, the system will show a confirmation card. Set booking.confirm=true ONLY after they confirm.`,
    quickReplies: slotChips(slots),
  };
}

// Class booking (Phase 2): the visitor reserves a spot in a scheduled session.
// Sessions are offered as tappable chips; chosen by matching the agent's
// date+time against an upcoming session; confirmed via the same card flow.
async function classBookingFlow({ site, booking, service, serviceName }) {
  const siteId = site.id;
  const r = await listClassSessions({ siteId, serviceId: service.id, allowedStatuses: ALLOWED });
  const sessions = r.ok ? r.sessions.filter((s) => s.spotsLeft > 0) : [];
  if (!sessions.length) {
    return { note: `BOOKING NOTE: There are no upcoming ${serviceName} classes with open spots in the next few weeks. Tell the visitor and suggest they check the booking page or ask about another class. Do NOT invent class times.` };
  }

  const date = typeof booking.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(booking.date.trim()) ? booking.date.trim() : null;
  const time = normTime(booking.time);
  const chosen = (date && time) ? sessions.find((s) => s.date === date && s.time === time) : null;

  // No session pinned yet → offer the upcoming sessions as chips.
  if (!chosen) {
    const lines = sessions.slice(0, 6).map((s) =>
      `${s.label}${s.instructor ? ` (${s.instructor})` : ''} — ${s.spotsLeft} spot${s.spotsLeft === 1 ? '' : 's'} left`).join('; ');
    return {
      note: `UPCOMING ${serviceName.toUpperCase()} CLASSES (offer ONLY these — they're shown as tappable chips): ${lines}. Once the visitor picks one AND you have their name plus an email or phone, the system shows a confirmation card. Set booking.confirm=true ONLY after they confirm.`,
      quickReplies: sessions.slice(0, 6).map((s) => s.label),
    };
  }

  const cust = booking.customer || {};
  const hasContact = (cust.email && norm(cust.email)) || (cust.phone && norm(cust.phone));
  const ready = cust.name && hasContact;
  if (!ready) {
    return { note: `BOOKING NOTE: The visitor chose ${serviceName} on ${chosen.label}${chosen.instructor ? ` with ${chosen.instructor}` : ''}. Ask for their name and an email or phone to reserve the spot. Don't set confirm yet.` };
  }

  const priced = (service.price_cents || 0) > 0;

  // PAID class, or free-not-yet-confirmed → confirm step (payment card or confirm card).
  if (priced || booking.confirm !== true) {
    return confirmStep({
      site, service, serviceName,
      title: priced ? 'Complete your booking' : 'Confirm your spot',
      lines: [serviceName, chosen.instructor ? `with ${chosen.instructor}` : null, chosen.label, cust.name].filter(Boolean),
      pending: { kind: 'class', serviceId: service.id, sessionId: chosen.id, customer: cust },
    });
  }

  // FREE + confirmed → reserve the spot.
  const [firstName, ...rest] = String(cust.name).trim().split(/\s+/);
  const br = await bookClassSession({
    siteId, sessionId: chosen.id,
    customer: { firstName, lastName: rest.join(' ') || null, email: cust.email || null, phone: cust.phone || null },
    notes: booking.notes || null,
    allowedStatuses: ALLOWED, emailFromName: site.company?.name || 'Bookings',
  });
  if (br.ok) {
    return {
      note: `BOOKING CONFIRMED: Reserved ${serviceName} on ${br.booking.date} at ${br.booking.time}. Warmly confirm in ONE short sentence${cust.email ? ' and mention a confirmation email is on the way' : ''}. The details are on a card. Stop collecting booking details.`,
      card: {
        kind: 'booking_done',
        title: "You're booked! 🎉",
        lines: [serviceName, chosen.instructor ? `with ${chosen.instructor}` : null, `${br.booking.date} · ${br.booking.time}`].filter(Boolean),
      },
    };
  }
  if (br.code === 409) {
    const fresh = await listClassSessions({ siteId, serviceId: service.id, allowedStatuses: ALLOWED });
    const open = fresh.ok ? fresh.sessions.filter((s) => s.spotsLeft > 0) : [];
    return {
      note: `BOOKING NOTE: ${br.message} Apologise and offer the visitor another class from the times shown.`,
      quickReplies: open.slice(0, 6).map((s) => s.label),
    };
  }
  return { note: `BOOKING NOTE: The booking couldn't be completed (${br.message}). Apologise and suggest the visitor use the booking page on this site.` };
}

// The confirm step, shared by appointment + class flows. FREE → a confirm card
// (the agent's confirm=true then books). PAID → a Stripe payment card when the
// business can take payments (P3 in-chat "Buy & Book"), else a booking-page
// handoff. When a payment card is shown, returns `pendingPayment` so the chat
// controller persists the resolved booking for /complete-booking after the charge.
async function confirmStep({ site, service, serviceName, lines, title, pending }) {
  const priced = (service.price_cents || 0) > 0;
  if (!priced) {
    return {
      note: `BOOKING NOTE: Show the confirmation card and ask the visitor to confirm (a card with "Confirm booking" / "Not now" is displayed). Keep your reply to one short line. Set booking.confirm=true ONLY when they say yes.`,
      card: {
        kind: 'booking_confirm', title: title || 'Confirm your booking', lines, price: 'Free',
        actions: [
          { label: 'Confirm booking', value: 'Yes, please confirm my booking.' },
          { label: 'Not now', value: 'Actually, not now.' },
        ],
      },
    };
  }

  const priceLabel = `$${(service.price_cents / 100).toFixed(0)}`;
  const intent = await createBookingIntent({ siteId: site.id, serviceId: service.id });

  // Paid but the business can't take card payments → hand off to the booking page.
  if (!intent.ok || intent.free) {
    return {
      note: `BOOKING NOTE: "${serviceName}" is ${priceLabel} and is paid on the booking page. Briefly tell the visitor to book & pay there (a card with a button is shown). Offer to help with anything else.`,
      card: { kind: 'handoff_booking', title: 'Book & pay online', lines: [serviceName, `${priceLabel} · secure card payment`], actions: [{ label: 'Open booking page', href: '/book' }] },
    };
  }

  // Stripe-ready → show an in-chat payment card.
  return {
    note: `BOOKING NOTE: A secure payment card for ${serviceName} (${priceLabel}) is shown. In ONE short line, ask the visitor to enter their card to confirm the booking. Do NOT say it's already booked.`,
    card: {
      kind: 'booking_payment', title: title || 'Complete your booking', lines, price: priceLabel,
      payment: { clientSecret: intent.clientSecret, publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || null, amount: intent.amount, currency: intent.currency },
    },
    pendingPayment: { ...pending, paymentIntentId: intent.paymentIntentId, amount: intent.amount, summary: lines },
  };
}

module.exports = { runBookingTool };
