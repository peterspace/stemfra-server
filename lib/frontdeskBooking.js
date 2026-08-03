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
const { getStripeForSite } = require('./paymentCredentials');

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

// ─── Rich cards for the widget's docked panels (Mindbody-style) ──────────────
// `options` renders a scrollable "Choose an option below" list; `calendar`
// renders the date strip + staff filter + session list. The widget falls back to
// inline chips when no card is sent, so these are additive.
/** How far ahead the appointment date-picker looks, and how many times per day it
 *  offers. Bounded because each day costs an availability query per candidate. */
const PICKER_DAYS = 7;
const PICKER_SLOTS_PER_DAY = 6;

const optionsCard = (title, options) => ({ kind: 'options', title, options });

/** Collect the visitor's details as a FORM rather than as prose. Asking "may I
 *  have your name and email?" in chat left people re-tapping the calendar, which
 *  re-opened the calendar, which asked again. A form gives them the one action
 *  that actually moves the booking forward. */
const detailsCard = (title) => ({
  kind: 'form',
  title: title || 'Your details',
  hint: 'We send your confirmation by email and use the phone number if we need to reach you about this booking.',
  submitLabel: 'Continue',
  // ALL THREE ARE REQUIRED. They were optional-past-the-name, which quietly
  // defeated the point: a booking with no email and no phone is a lead nobody
  // can confirm, remind or reach if the time has to change.
  fields: [
    { name: 'name', label: 'Full name', type: 'text', required: true },
    { name: 'email', label: 'Email', type: 'email', required: true },
    { name: 'phone', label: 'Phone', type: 'tel', required: true },
  ],
});

const money = (cents) => `$${((cents || 0) / 100).toFixed((cents || 0) % 100 === 0 ? 0 : 2)}`;

// Can this site ACTUALLY take a card right now? `payments_enabled` is only the
// owner's intent; the rail exists only if an active Stripe credential decrypts.
// getStripeForSite returns null when the credential is missing, revoked, or when
// PAYMENT_CREDENTIALS_KEK is absent from the environment — so a whole deployment
// can be enabled-but-unpayable, not just one misconfigured tenant.
// Resolved ONCE per turn in runBookingTool and cached on the site object, so the
// four payAtVenueAllowed() call sites stay synchronous and we do one lookup.
const resolveCardRail = async (site) => {
  if (site?.payments_enabled !== true) return false;
  try { return !!(await getStripeForSite(site.id)); } catch { return false; }
};

// Pay at the place of service. booking_config.pay_at_venue:
//   'auto'   (default) — offered whenever the site has no USABLE card rail, so a
//                        studio that takes money at the door completes the booking
//                        in chat instead of dead-ending the visitor on /book
//   'always'           — offered even when cards are available
//   'never'            — prepayment required; card or nothing
//
// 'auto' deliberately keys off the real rail, not `payments_enabled`. A site with
// payments_enabled=true and no working credential used to fail BOTH ways: pay at
// venue was refused because intent was true, and the card path could not complete
// because there was no rail, so the visitor hit a handoff card AFTER filling in
// the details form. Now that case degrades to pay-at-venue and the booking lands.
// 'never' is left strict on purpose: the owner explicitly required prepayment, and
// silently taking a door payment would override a real business decision (deposits
// exist to stop no-shows). Such a site with a broken rail still hands off, which is
// the correct outcome for a misconfiguration the owner has to fix.
const payAtVenueAllowed = (site) => {
  const mode = String(site?.booking_config?.pay_at_venue || 'auto').toLowerCase();
  if (mode === 'never') return false;
  if (mode === 'always') return true;
  return site?._cardRailReady !== true;
};

// The booking cores derive amount_cents from a Stripe PaymentIntent, and a
// pay-at-venue booking has none. Stamp it afterwards so the money still shows in
// Reports as "collected at visit · still due" until the owner marks it collected.
async function stampAtVenueAmount(bookingId, priceCents) {
  if (!bookingId || !(priceCents > 0)) return;
  const { error } = await supabase.from('site_bookings')
    .update({ amount_cents: priceCents }).eq('id', bookingId);
  if (error) console.error('[frontdesk] at-venue amount stamp failed:', error.message);
}

// What a pass actually buys, as structured data rather than prose. The count and
// validity live on site_products.metadata, so every tenant reads the same way
// regardless of how (or whether) they wrote a description. Falls back to their
// own description when a pack carries no metadata.
const packSublabel = (p) => {
  const classes = Number(p.metadata?.classes ?? 0);
  const days = Number(p.metadata?.expires_days ?? 0);
  const bits = [];
  if (classes === 1) bits.push('Single class');
  else if (classes > 1) bits.push(`${classes} sessions`);
  if (days > 0) {
    const months = days / 30;
    bits.push(Number.isInteger(months) && months >= 1
      ? `valid ${months} month${months > 1 ? 's' : ''}`
      : `valid ${days} days`);
  }
  return bits.length ? bits.join(' · ') : (en(p.description) || undefined);
};

const calendarCard = ({ title, sessions, staff, dates }) => ({
  kind: 'calendar',
  title: title || 'Select a day and time for your booking',
  dates: dates && dates.length ? dates : undefined,
  staff: staff && staff.length ? staff : undefined,
  sessions,
});
/** "July 31, 2026 at 5:00 PM" — what the visitor sees in their own bubble after
 *  tapping a slot. The raw "2026-07-31 17:00" read like a machine talking. */
const fmtWhenLong = (date, time, zone) => {
  const d = DateTime.fromISO(`${date}T${String(time).slice(0, 5)}`, { zone });
  return d.isValid ? d.toFormat("LLLL d, yyyy 'at' h:mm a") : `${date} ${time}`;
};

/**
 * Recover the slot from the visitor's own words.
 *
 * The calendar sends a human label ("August 1, 2026 at 9:30 AM") because that is
 * what belongs in their bubble — but then the AGENT has to parse it back into
 * date+time, and when it fumbles that we fell through and re-opened the calendar,
 * asking for details it had just asked for. Parsing it here removes the agent
 * from the loop entirely: the label we generated is the label we read back.
 */
const parseWhen = (text, zone) => {
  const m = /([A-Z][a-z]+)\s+(\d{1,2}),\s*(\d{4})\s+at\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(String(text || ''));
  if (!m) return null;
  const d = DateTime.fromFormat(
    `${m[1]} ${m[2]} ${m[3]} ${m[4]}:${m[5]} ${m[6].toUpperCase()}`,
    'LLLL d yyyy h:mm a', { zone },
  );
  return d.isValid ? { date: d.toFormat('yyyy-MM-dd'), time: d.toFormat('HH:mm') } : null;
};

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
// Class packs / passes the studio sells (Mindbody's "purchase a package first"
// model). Empty for sites that don't sell them → the gate is skipped entirely.
async function loadClassPacks(siteId) {
  const { data } = await supabase
    .from('site_products')
    .select('id, name, description, price_cents, metadata')
    .eq('site_id', siteId)
    .eq('product_type', 'class_pack')
    .eq('is_active', true)
    .order('display_order');
  return data || [];
}

async function runBookingTool({ site, booking, zone, userMessage }) {
  if (!booking || norm(booking.intent) !== 'book') return { note: null };

  const siteId = site.id;
  const bizName = site.company?.name || 'the business';

  // GATE: Stemfra's native engine is the only booking system. Sites set to
  // "no online booking" (consultation_form) get a contact handoff instead.
  const mode = site.booking_mode || 'native';
  if (mode !== 'native') {
    return {
      note: `BOOKING NOTE: ${bizName} doesn't take online bookings through chat. In ONE short line, invite the visitor to call or visit to book, or offer to take their name + number for a callback. Do NOT ask for a service/date/time.`,
    };
  }

  // One credential lookup per turn; every payAtVenueAllowed() below reads this.
  site._cardRailReady = await resolveCardRail(site);

  const { data: services } = await supabase
    .from('site_services')
    .select('id, name, price_cents, duration_minutes, bookable, is_active, kind, capacity')
    .eq('site_id', siteId);
  const bookable = (services || []).filter((s) => s.is_active && s.bookable);

  // No service named yet → show the real menu in the docked options panel
  // instead of asking "which one?" in prose (reference behaviour).
  if (!booking.service) {
    const options = bookable.map((s) => ({
      label: en(s.name),
      value: en(s.name),
      sublabel: s.duration_minutes ? `${s.duration_minutes} min` : undefined,
      price: s.price_cents > 0 ? `$${(s.price_cents / 100).toFixed(0)}` : 'Free',
    })).filter((o) => o.label);
    if (!options.length) return { note: null };
    return {
      note: `BOOKING NOTE: The visitor wants to book but hasn't named a service. A list of our bookable options is shown. In ONE short line, invite them to choose from the list. Do NOT list the services in your text.`,
      card: optionsCard('Choose an option below', options),
    };
  }

  const service = bestMatch(bookable, booking.service, (s) => en(s.name));
  if (!service) {
    const list = bookable.map((s) => en(s.name)).filter(Boolean).join(', ');
    // Offer the real menu in the docked options panel rather than a wall of text.
    const options = bookable.map((s) => ({
      label: en(s.name),
      value: en(s.name),
      sublabel: s.duration_minutes ? `${s.duration_minutes} min` : undefined,
      price: s.price_cents > 0 ? `$${(s.price_cents / 100).toFixed(0)}` : 'Free',
    })).filter((o) => o.label);
    return {
      note: `BOOKING NOTE: There's no bookable service matching "${booking.service}". Our bookable services are: ${list || '(none configured)'}. In ONE short line, ask the visitor to choose from the list shown.`,
      card: options.length ? optionsCard('Choose an option below', options) : undefined,
    };
  }
  const serviceName = en(service.name);

  // CLASS → book a spot in a scheduled session (Phase 2). Payment (if priced) is
  // handled at the confirm step inside the flow (P3).
  if (service.kind === 'class') {
    return await classBookingFlow({ site, booking, service, serviceName, userMessage });
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

  // Resolve barber: a named one must match; "any"/blank → first with availability.
  const named = booking.barber && norm(booking.barber) !== 'any' ? bestMatch(activeTeam, booking.barber, (t) => t.name) : null;
  if (booking.barber && norm(booking.barber) !== 'any' && !named) {
    const list = activeTeam.map((t) => t.name).join(', ');
    return { note: `BOOKING NOTE: We don't have a barber called "${booking.barber}". Our barbers are: ${list}. Ask which barber they'd like (or "any").` };
  }

  const picked = parseWhen(userMessage, zone || site.time_zone);
  const date = (typeof booking.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(booking.date.trim()) ? booking.date.trim() : null)
    || picked?.date || null;

  // NO DATE YET → open the SAME calendar drawer classes use, built from real
  // appointment availability. Previously this returned nothing at all, so the
  // agent asked "please choose a date" with no picker anywhere, the visitor had
  // nothing to tap, and the conversation went in circles.
  if (!date) {
    const zone2 = site.time_zone || zone || 'America/New_York';
    const today = DateTime.now().setZone(zone2);
    const pickCandidates = named ? [named] : activeTeam;
    // Days run in PARALLEL: sequentially this was 5.5s of round-trips before the
    // agent even saw the result, on top of the workflow hop. Within a day we still
    // stop at the first free member, since one is enough to offer the day.
    const perDay = await Promise.all(
      Array.from({ length: PICKER_DAYS }, (_, i) => today.plus({ days: i }).toFormat('yyyy-MM-dd'))
        .map(async (d) => {
          for (const member of pickCandidates) {
            const r = await computeAvailability({ siteId, teamMemberId: member.id, serviceId: service.id, date: d, allowedStatuses: ALLOWED });
            if (r.ok && r.slots.length) return { d, member, slots: r.slots.slice(0, PICKER_SLOTS_PER_DAY) };
          }
          return null;
        }),
    );
    const sessions = [];
    const staffSeen = new Map();
    for (const hit of perDay.filter(Boolean)) {
      staffSeen.set(hit.member.id, hit.member.name);
      for (const t of hit.slots) {
        sessions.push({ date: hit.d, time: fmtTime(t), name: serviceName, staff: hit.member.name, value: fmtWhenLong(hit.d, t, zone2) });
      }
    }
    if (!sessions.length) {
      return { note: `BOOKING NOTE: There is nothing free for ${serviceName} in the next ${PICKER_DAYS} days. Say so in one short line and offer to pass their details to the team. Do NOT invent times.` };
    }
    return {
      note: `A CALENDAR of real openings for ${serviceName} is displayed beside the chat. In ONE short line invite the visitor to pick a day and time from it. Do NOT list dates or times in your text and do NOT ask them to type a date, the calendar already shows them.`,
      card: calendarCard({
        title: 'Select a day and time for your booking',
        sessions,
        staff: [...staffSeen].map(([id, name]) => ({ id: name, name })),
        dates: [...new Set(sessions.map((x) => x.date))],
      }),
    };
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

  const time = normTime(booking.time) || picked?.time || null;
  const cust = booking.customer || {};
  // BOTH, not either: the confirmation goes by email and the phone is how the
  // shop reaches someone when a time has to move. See detailsCard().
  const hasContact = !!(cust.email && norm(cust.email)) && !!(cust.phone && norm(cust.phone));
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
  const atVenue = priced && payAtVenueAllowed(site);
  if (ready && timeOk && (!priced || atVenue) && booking.confirm === true) {
    const [firstName, ...rest] = String(cust.name).trim().split(/\s+/);
    const r = await placeBooking({
      siteId, teamMemberId: chosen.id, serviceId: service.id, date, time,
      customer: { firstName, lastName: rest.join(' ') || null, email: cust.email || null, phone: cust.phone || null },
      notes: booking.notes || null,
      allowedStatuses: ALLOWED, emailFromName: bizName,
    });
    if (r.ok) {
      if (atVenue) await stampAtVenueAmount(r.booking.id, service.price_cents);
      return {
        note: `BOOKING CONFIRMED: Booked ${serviceName} with ${chosen.name} on ${r.booking.date} at ${r.booking.time}.${atVenue ? ` They pay ${money(service.price_cents)} at the studio when they arrive — say so in the same sentence.` : ''} Warmly confirm in ONE short sentence${cust.email ? ' and mention a confirmation email is on the way' : ''}. The details are shown on a card, don't repeat them all. Stop collecting booking details.`,
        card: { kind: 'booking_done', title: "You're booked",
          lines: [serviceName, `with ${chosen.name}`, `${r.booking.date} · ${r.booking.time}`,
            atVenue ? `${money(service.price_cents)} to pay at the studio` : null].filter(Boolean) },
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
      userMessage, isClass: false,
    });
  }

  // A time IS chosen, only the details are missing. Previously this fell through
  // and re-opened the calendar, so the visitor tapped another slot, which asked
  // for details again — the loop Peter hit. Show the form instead.
  if (timeOk) {
    return {
      note: `BOOKING NOTE: ${serviceName} on ${fmtDate(date, zone)} at ${fmtTime(time)} is held. A short form asking for their name, email and phone is shown. In ONE short line ask them to fill it in. Do NOT ask for the details in your text and do NOT offer times again.`,
      card: detailsCard('Your details'),
    };
  }

  // Otherwise we have real slots — open the calendar panel and walk to a confirm.
  return {
    note: `AVAILABLE TIMES for ${serviceName} ${barberClause} on ${fmtDate(date, zone)}: ${fmtSlots(slots)}. Offer these real times only (a calendar showing them is displayed). Once the visitor picks a time AND you have their name, email and phone, the system will show a confirmation card. Set booking.confirm=true ONLY after they confirm.`,
    card: calendarCard({
      sessions: slots.map((t) => ({
        id: t,
        time: fmtTime(t),
        name: serviceName,
        staff: chosen.name,
        value: fmtTime(t),
      })),
      staff: activeTeam.map((t) => ({ id: t.id, name: t.name })),
      dates: [date],
    }),
    quickReplies: slotChips(slots),
  };
}

// Class booking (Phase 2): the visitor reserves a spot in a scheduled session.
// Sessions are offered as tappable chips; chosen by matching the agent's
// date+time against an upcoming session; confirmed via the same card flow.
async function classBookingFlow({ site, booking, service, serviceName, userMessage }) {
  const siteId = site.id;
  const r = await listClassSessions({ siteId, serviceId: service.id, allowedStatuses: ALLOWED });
  const sessions = r.ok ? r.sessions.filter((s) => s.spotsLeft > 0) : [];
  if (!sessions.length) {
    return { note: `BOOKING NOTE: There are no upcoming ${serviceName} classes with open spots in the next few weeks. Tell the visitor and suggest they check the booking page or ask about another class. Do NOT invent class times.` };
  }

  const date = typeof booking.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(booking.date.trim()) ? booking.date.trim() : null;
  const time = normTime(booking.time);
  const chosen = (date && time) ? sessions.find((s) => s.date === date && s.time === time) : null;

  // No session pinned yet → open the calendar panel (date strip + staff filter).
  if (!chosen) {
    const zone = site.time_zone || 'America/New_York';
    const staff = [...new Set(sessions.map((s) => s.instructor).filter(Boolean))]
      .map((name) => ({ id: name, name }));
    const dates = [...new Set(sessions.map((s) => s.date).filter(Boolean))];
    return {
      // Deliberately does NOT enumerate the sessions. When we handed the model the
      // full list it recited it back as prose ("Fri, Jul 31 · 5:30 PM, Sat, Aug 1 ·
      // 5:30 PM, …"), duplicating the calendar sitting right next to it and reading
      // like a wall of text. The CARD is the schedule; the reply just points at it.
      // Same discipline as the pack gate, which already says "do NOT list them".
      note: `A CALENDAR of real ${serviceName} classes is displayed beside the chat: ${sessions.length} session${sessions.length === 1 ? '' : 's'} across ${dates.length} day${dates.length === 1 ? '' : 's'}, the first on ${fmtDate(dates[0], zone)}. In ONE short line, invite the visitor to pick a day and time from the calendar. Do NOT list the classes, dates or times in your text — the calendar already shows them. Once they pick one AND you have their name, email and phone, the system shows a confirmation card. Set booking.confirm=true ONLY after they confirm.`,
      card: calendarCard({
        sessions: sessions.map((s) => ({
          id: s.id,
          date: s.date,
          time: fmtTime(s.time),
          name: serviceName,
          staff: s.instructor || undefined,
          value: s.label,
          full: s.spotsLeft <= 0,
          spots: s.spotsLeft,
        })),
        staff,
        dates,
      }),
      quickReplies: sessions.slice(0, 6).map((s) => s.label),
    };
  }

  const cust = booking.customer || {};
  // BOTH, not either: the confirmation goes by email and the phone is how the
  // shop reaches someone when a time has to move. See detailsCard().
  const hasContact = !!(cust.email && norm(cust.email)) && !!(cust.phone && norm(cust.phone));
  const ready = cust.name && hasContact;
  if (!ready) {
    return {
      note: `BOOKING NOTE: ${serviceName} on ${chosen.label}${chosen.instructor ? ` with ${chosen.instructor}` : ''} is held. A short form asking for their name, email and phone is shown. In ONE short line ask them to fill it in. Do NOT ask for the details in your text. Don't set confirm yet.`,
      card: detailsCard('Your details'),
    };
  }

  const priced = (service.price_cents || 0) > 0;

  // Confirm step for anything not yet confirmed, and for paid classes that still
  // need a payment method. A pay-at-venue class the visitor already confirmed falls
  // through to the write below.
  const atVenueReady = priced && payAtVenueAllowed(site) && booking.confirm === true;
  if ((priced && !atVenueReady) || booking.confirm !== true) {
    return confirmStep({
      site, service, serviceName,
      title: priced ? 'Complete your booking' : 'Confirm your spot',
      lines: [serviceName, chosen.instructor ? `with ${chosen.instructor}` : null, chosen.label, cust.name].filter(Boolean),
      pending: { kind: 'class', serviceId: service.id, sessionId: chosen.id, customer: cust },
      userMessage, isClass: true,
    });
  }

  // FREE (or pay-at-venue) + confirmed → reserve the spot.
  const atVenueClass = (service.price_cents || 0) > 0 && payAtVenueAllowed(site);
  const [firstName, ...rest] = String(cust.name).trim().split(/\s+/);
  const br = await bookClassSession({
    siteId, sessionId: chosen.id,
    customer: { firstName, lastName: rest.join(' ') || null, email: cust.email || null, phone: cust.phone || null },
    notes: booking.notes || null,
    allowedStatuses: ALLOWED, emailFromName: site.company?.name || 'Bookings',
  });
  if (br.ok) {
    if (atVenueClass) await stampAtVenueAmount(br.booking.id, service.price_cents);
    return {
      note: `BOOKING CONFIRMED: Reserved ${serviceName} on ${br.booking.date} at ${br.booking.time}.${atVenueClass ? ` They pay ${money(service.price_cents)} at the studio when they arrive, say so in the same sentence.` : ''} Warmly confirm in ONE short sentence${cust.email ? ' and mention a confirmation email is on the way' : ''}. The details are on a card. Stop collecting booking details.`,
      card: {
        kind: 'booking_done',
        title: "You're booked",
        lines: [serviceName, chosen.instructor ? `with ${chosen.instructor}` : null, `${br.booking.date} · ${br.booking.time}`,
          atVenueClass ? `${money(service.price_cents)} to pay at the studio` : null].filter(Boolean),
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
async function confirmStep({ site, service, serviceName, lines, title, pending, userMessage, isClass }) {
  const priced = (service.price_cents || 0) > 0;

  // Pay at the studio: a real confirm card that COMPLETES the booking, rather than
  // handing the visitor to /book to start the last mile again.
  if (priced && payAtVenueAllowed(site)) {
    return {
      note: `BOOKING NOTE: A summary is shown with the total ${money(service.price_cents)}, payable at the studio on arrival. In ONE short line ask the visitor to confirm, and make clear they pay when they arrive rather than now. Set booking.confirm=true ONLY when they say yes.`,
      card: {
        kind: 'booking_confirm',
        title: title || 'Confirm your booking',
        lines: [...lines, 'Pay at the studio when you arrive'],
        price: money(service.price_cents),
        actions: [
          { label: 'Confirm booking', value: 'Yes, please confirm my booking.' },
          { label: 'Not now', value: 'Actually, not now.' },
        ],
      },
    };
  }

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

  // PACKAGE GATE (Mindbody model): studios that sell class packs require one
  // before a class is booked. Skipped entirely when the site sells none.
  if (isClass) {
    const packs = await loadClassPacks(site.id);
    if (packs.length) {
      const chosenPack = bestMatch(packs, userMessage, (p) => en(p.name));
      if (!chosenPack) {
        return {
          note: `BOOKING NOTE: Before booking, ${en(service.name) || 'this class'} needs a class pass. The passes are shown as a list. In ONE short line, say we just need them to pick a pass first. Do NOT list the passes in your text.`,
          card: optionsCard('Choose an option below', packs.map((p) => ({
            label: en(p.name),
            value: en(p.name),
            sublabel: packSublabel(p),
            price: `$${(p.price_cents / 100).toFixed(0)}`,
          }))),
        };
      }
      // A pass was chosen. SINGLE-class passes are bought in chat (the pass is
      // consumed by this booking, so nothing is left to track). MULTI-class
      // packs hand off: we'd be selling credits we have no ledger to hold, and
      // taking money for 9 unrecorded classes would be selling what we can't
      // deliver. Inline multi-class purchase needs a credits ledger first.
      const packClasses = Number(chosenPack.metadata?.classes ?? 1);
      const packLines = [...lines, en(chosenPack.name), packClasses > 1 ? `${packClasses} classes` : null].filter(Boolean);
      const packPrice = `$${(chosenPack.price_cents / 100).toFixed(0)}`;

      if (packClasses <= 1) {
        const packIntent = await createBookingIntent({
          siteId: site.id, serviceId: service.id, productId: chosenPack.id,
        });
        if (packIntent.ok && !packIntent.free) {
          return {
            note: `BOOKING NOTE: A secure payment card for the "${en(chosenPack.name)}" pass (${packPrice}) is shown. In ONE short line, ask the visitor to enter their card to confirm. Do NOT say it's already booked.`,
            card: {
              kind: 'booking_payment', title: 'Complete your booking', lines: packLines, price: packPrice,
              payment: {
                clientSecret: packIntent.clientSecret,
                publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || null,
                amount: packIntent.amount,
                currency: packIntent.currency,
              },
            },
            pendingPayment: { ...pending, paymentIntentId: packIntent.paymentIntentId, amount: packIntent.amount, summary: packLines },
          };
        }
      }

      return {
        note: `BOOKING NOTE: The visitor picked the "${en(chosenPack.name)}" pass. A summary with the pass and total is shown, with a button to complete the purchase on the booking page. In ONE short line, tell them to finish on the booking page. Do NOT say it's already booked.`,
        card: {
          kind: 'handoff_booking',
          title: 'Buy and book',
          lines: packLines,
          price: packPrice,
          actions: [
            { label: 'Buy and book', href: '/book' },
            { label: 'Not now', value: 'Actually, not now.' },
          ],
        },
      };
    }
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
