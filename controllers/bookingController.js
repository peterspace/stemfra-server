const supabase = require('../config/supabase');
const { DateTime } = require('luxon');
const { stripe } = require('../config/stripe');
const { sendMail } = require('../lib/mailer');

const en = (v) => (v && typeof v === 'object' ? (v.en ?? '') : (v || ''));
const emails = require('../templates/transactionalEmails');
const { sendOwnerNewBookingEmail } = require('./../lib/bookingEmails');

// Tenant email bits for confirmations: the business logo
// (site_theme_settings.logo_url) + its public email (home location_map section
// content.email, CMS-editable) — used in the branded header, the anti-phishing
// footer line, and as the reply-to so "just reply" actually reaches the
// business. Best-effort: the confirmation still sends without them.
const getTenantEmailBits = async (siteId) => {
  const bits = { logoUrl: null, businessEmail: null, businessUrl: null };
  try {
    const { data: theme } = await supabase.from('site_theme_settings').select('logo_url').eq('site_id', siteId).maybeSingle();
    bits.logoUrl = theme?.logo_url || null;
    const { data: site } = await supabase.from('sites').select('subdomain, custom_domain').eq('id', siteId).maybeSingle();
    if (site) bits.businessUrl = `https://${site.custom_domain || `${site.subdomain}.stemfra.com`}`;
    const { data: page } = await supabase.from('site_pages').select('id').eq('site_id', siteId).eq('slug', 'home').maybeSingle();
    if (page) {
      const { data: secs } = await supabase.from('site_sections').select('content').eq('page_id', page.id).eq('section_type', 'location_map').limit(1);
      bits.businessEmail = secs?.[0]?.content?.email || null;
    }
  } catch { /* best-effort */ }
  return bits;
};

const SLOT_GRID_MINUTES = 15;

// ─── Core: compute available start times (no HTTP) ───────────────────────────
// Returns { ok, code?, message?, slots, duration, reason?, zone }. Shared by the
// public GET handler (allowedStatuses=['live']) and the Front Desk chat booking
// tool (allowedStatuses=['live','previewing'] so it's testable on preview sites).
const computeAvailability = async ({ siteId, teamMemberId, serviceId, date, allowedStatuses = ['live'] }) => {
  if (!siteId || !teamMemberId || !serviceId || !date) {
    return { ok: false, code: 400, message: 'Missing required parameters.' };
  }

  // Site (for timezone + status check)
  const { data: site, error: siteErr } = await supabase
    .from('sites').select('id, status, time_zone').eq('id', siteId).single();
  if (siteErr || !site) return { ok: false, code: 404, message: 'Site not found.' };
  if (!allowedStatuses.includes(site.status)) return { ok: false, code: 403, message: 'Site not live.' };

  const zone = site.time_zone || 'America/New_York';

  // Service duration
  const { data: service, error: svcErr } = await supabase
    .from('site_services').select('id, duration_minutes').eq('id', serviceId).eq('site_id', siteId).single();
  if (svcErr || !service) return { ok: false, code: 404, message: 'Service not found.' };
  const duration = service.duration_minutes || 30;

  // The target date in the site's zone
  const day = DateTime.fromISO(date, { zone });
  if (!day.isValid) return { ok: false, code: 400, message: 'Invalid date.' };
  // Luxon weekday: 1=Mon..7=Sun. Stored day_of_week: 0=Sun..6=Sat. Conversion: weekday % 7.
  const dow = day.weekday % 7;
  const startOfDay = day.startOf('day');
  const endOfDayNext = startOfDay.plus({ days: 1 });

  // Availability rules for this barber
  const { data: rules } = await supabase
    .from('site_availability_rules').select('*')
    .eq('team_member_id', teamMemberId).eq('site_id', siteId).eq('is_active', true);

  // Is the barber off this whole day? (time_off / date_override covering the date)
  const isOff = (rules || []).some(r => {
    if (r.rule_type !== 'time_off' && r.rule_type !== 'date_override') return false;
    if (!r.start_date) return false;
    const s = DateTime.fromISO(r.start_date, { zone });
    const e = r.end_date ? DateTime.fromISO(r.end_date, { zone }) : s;
    return day >= s.startOf('day') && day <= e.endOf('day');
  });
  if (isOff) return { ok: true, slots: [], reason: 'off', duration, zone };

  // Working windows for this weekday (weekly_recurring rules matching dow)
  const windows = (rules || [])
    .filter(r => r.rule_type === 'weekly_recurring' && r.day_of_week === dow && r.start_time && r.end_time)
    .map(r => ({
      start: DateTime.fromISO(`${date}T${r.start_time}`, { zone }),
      end:   DateTime.fromISO(`${date}T${r.end_time}`, { zone }),
    }));
  if (windows.length === 0) return { ok: true, slots: [], reason: 'closed', duration, zone };

  // Existing bookings for this barber on this day (overlap check)
  const { data: bookings } = await supabase
    .from('site_bookings').select('starts_at, ends_at, status')
    .eq('team_member_id', teamMemberId).eq('site_id', siteId)
    .neq('status', 'cancelled')
    .gte('starts_at', startOfDay.toUTC().toISO())
    .lt('starts_at', endOfDayNext.toUTC().toISO());

  const busy = (bookings || []).map(b => ({
    start: DateTime.fromISO(b.starts_at, { zone }),
    end:   DateTime.fromISO(b.ends_at, { zone }),
  }));

  // Generate candidate start times on the 15-min grid within each window,
  // keep those where the full service duration fits inside the window and doesn't overlap a booking.
  const now = DateTime.now().setZone(zone);
  const slots = [];
  for (const w of windows) {
    let cursor = w.start;
    while (cursor.plus({ minutes: duration }) <= w.end) {
      const slotStart = cursor;
      const slotEnd = cursor.plus({ minutes: duration });
      const inPast = slotStart < now;
      const overlaps = busy.some(b => slotStart < b.end && slotEnd > b.start);
      if (!inPast && !overlaps) {
        slots.push(slotStart.toFormat('HH:mm'));
      }
      cursor = cursor.plus({ minutes: SLOT_GRID_MINUTES });
    }
  }

  // Dedupe + sort (in case of overlapping windows)
  const unique = [...new Set(slots)].sort();
  return { ok: true, slots: unique, duration, zone };
};

// ─── GET /api/site-bookings/availability?siteId=&teamMemberId=&serviceId=&date=YYYY-MM-DD ───
// Public (booking page) — live sites only. Thin wrapper over computeAvailability.
const getAvailability = async (req, res) => {
  try {
    const r = await computeAvailability({ ...req.query, allowedStatuses: ['live'] });
    if (!r.ok) return res.status(r.code).json({ success: false, message: r.message });
    return res.json({ success: true, slots: r.slots, duration: r.duration, ...(r.reason ? { reason: r.reason } : {}) });
  } catch (err) {
    console.error('getAvailability error:', err);
    return res.status(500).json({ success: false, message: 'Could not load availability.' });
  }
};

// ─── Core: place a single booking (no HTTP) ──────────────────────────────────
// Returns { ok, code?, message?, idempotent?, booking }. Shared by the public
// POST handler (allowedStatuses=['live']) and the Front Desk chat booking tool
// (allowedStatuses=['live','previewing']). The chat tool only ever books FREE
// services (paid ones hand off to the booking page for card payment), so it
// passes no paymentIntentId; the Stripe path here stays for the public handler.
const placeBooking = async ({
  siteId, teamMemberId, serviceId, date, time, customer, notes, paymentIntentId,
  allowedStatuses = ['live'], emailFromName = 'Argyle & Sons',
}) => {
  if (!siteId || !teamMemberId || !serviceId || !date || !time || !customer) {
    return { ok: false, code: 400, message: 'Missing required fields.' };
  }
  if (!customer.email && !customer.phone) {
    return { ok: false, code: 400, message: 'Please provide an email or phone.' };
  }

  const { data: site, error: siteErr } = await supabase
    .from('sites').select('id, status, time_zone, owner_contact_id').eq('id', siteId).single();
  if (siteErr || !site) return { ok: false, code: 404, message: 'Site not found.' };
  if (!allowedStatuses.includes(site.status)) return { ok: false, code: 403, message: 'Site not live.' };

  const zone = site.time_zone || 'America/New_York';

  const { data: service, error: svcErr } = await supabase
    .from('site_services').select('id, name, duration_minutes').eq('id', serviceId).eq('site_id', siteId).single();
  if (svcErr || !service) return { ok: false, code: 404, message: 'Service not found.' };
  const duration = service.duration_minutes || 30;

  const startsAt = DateTime.fromISO(`${date}T${time}`, { zone });
  if (!startsAt.isValid) return { ok: false, code: 400, message: 'Invalid date/time.' };
  const endsAt = startsAt.plus({ minutes: duration });

  // Re-check the slot is still free (guard against double-booking between availability load and submit)
  const { data: clashes } = await supabase
    .from('site_bookings').select('id, starts_at, ends_at')
    .eq('team_member_id', teamMemberId).eq('site_id', siteId).neq('status', 'cancelled')
    .gte('starts_at', startsAt.startOf('day').toUTC().toISO())
    .lt('starts_at', startsAt.startOf('day').plus({ days: 1 }).toUTC().toISO());
  const conflict = (clashes || []).some(b => {
    const bs = DateTime.fromISO(b.starts_at, { zone });
    const be = DateTime.fromISO(b.ends_at, { zone });
    return startsAt < be && endsAt > bs;
  });
  if (conflict) return { ok: false, code: 409, message: 'That time was just taken. Please pick another.' };

  // Payment verification — when the client paid (PaymentIntent), confirm with
  // Stripe that it actually succeeded before writing a paid booking. Idempotent
  // on the PI id, so a client retry (or a future webhook) never double-creates.
  let paymentFields = { payment_status: 'none', stripe_payment_intent_id: null, amount_cents: null, application_fee_cents: null };
  if (paymentIntentId) {
    if (!stripe) return { ok: false, code: 503, message: 'Payments are not configured.' };
    const { data: dupe } = await supabase
      .from('site_bookings').select('id, starts_at').eq('stripe_payment_intent_id', paymentIntentId).maybeSingle();
    if (dupe) {
      const ds = DateTime.fromISO(dupe.starts_at, { zone });
      return { ok: true, code: 200, idempotent: true, booking: { id: dupe.id, date: ds.toFormat('cccc, LLLL d'), time: ds.toFormat('h:mm a') } };
    }
    let pi;
    try {
      // Destination-charge PaymentIntents live on the PLATFORM account, so a
      // plain retrieve (no stripeAccount context) is correct.
      pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    } catch { return { ok: false, code: 400, message: 'Payment could not be verified.' }; }
    if (!pi || pi.status !== 'succeeded') return { ok: false, code: 402, message: 'Payment not completed.' };
    if (pi.metadata?.site_id !== siteId || pi.metadata?.service_id !== serviceId) {
      return { ok: false, code: 400, message: 'Payment does not match this booking.' };
    }
    paymentFields = {
      payment_status: 'paid',
      stripe_payment_intent_id: paymentIntentId,
      amount_cents: pi.amount,
      application_fee_cents: pi.application_fee_amount ?? null,
    };
  }

  // Upsert customer (match by email within the site if provided)
  let customerId = null;
  if (customer.email) {
    const { data: existing } = await supabase
      .from('site_customers').select('id, metadata').eq('site_id', siteId).eq('email', customer.email.trim().toLowerCase()).maybeSingle();
    if (existing) {
      // Suspended members can't book (hard account block).
      if (existing.metadata?.suspended) {
        return { ok: false, code: 403, message: 'This account is suspended. Please contact us.' };
      }
      customerId = existing.id;
    }
  }
  if (!customerId) {
    const { data: newCust, error: custErr } = await supabase
      .from('site_customers').insert([{
        site_id: siteId,
        first_name: customer.firstName?.trim() || null,
        last_name:  customer.lastName?.trim() || null,
        email:      customer.email?.trim().toLowerCase() || null,
        phone:      customer.phone?.trim() || null,
      }]).select().single();
    if (custErr) return { ok: false, code: 500, message: custErr.message };
    customerId = newCust.id;
  }

  // Create booking
  const { data: booking, error: bookErr } = await supabase
    .from('site_bookings').insert([{
      site_id: siteId,
      customer_id: customerId,
      team_member_id: teamMemberId,
      service_id: serviceId,
      service_name_snapshot: service.name,
      starts_at: startsAt.toUTC().toISO(),
      ends_at: endsAt.toUTC().toISO(),
      duration_minutes: duration,
      status: 'confirmed',
      customer_notes: notes?.trim() || null,
      confirmation_sent_at: null,
      ...paymentFields,
    }]).select().single();
  if (bookErr) return { ok: false, code: 500, message: bookErr.message };

  // Best-effort confirmation email to the customer
  try {
    if (customer.email) {
      const bits = await getTenantEmailBits(siteId);
      await sendMail({
        fromName: emailFromName,
        replyTo: bits.businessEmail || undefined,
        to: customer.email,
        subject: 'Your appointment is confirmed',
        text: `Your appointment is confirmed for ${startsAt.toFormat('cccc, LLLL d')} at ${startsAt.toFormat('h:mm a')}.\n\nWe look forward to seeing you.`,
        html: emails.bookingConfirmation({
          businessName: emailFromName,
          businessLogoUrl: bits.logoUrl,
        businessUrl: bits.businessUrl,
          businessEmail: bits.businessEmail,
          firstName: customer.firstName,
          serviceName: en(service.name) || 'Appointment',
          dateLabel: startsAt.toFormat('cccc, LLLL d'),
          timeLabel: startsAt.toFormat('h:mm a'),
          durationLabel: service.duration_minutes ? `${service.duration_minutes} min` : null,
        }),
      });
      await supabase.from('site_bookings').update({ confirmation_sent_at: new Date().toISOString() }).eq('id', booking.id);
    }
  } catch (emailErr) {
    console.error('booking confirmation email failed:', emailErr.message);
  }

  // N1: owner "you have a new booking" email (fire-and-forget; site toggle
  // via site_theme_settings.metadata.notify_owner_bookings !== false).
  sendOwnerNewBookingEmail(booking.id).catch(() => {});

  return {
    ok: true,
    code: 201,
    booking: {
      id: booking.id,
      date: startsAt.toFormat('cccc, LLLL d'),
      time: startsAt.toFormat('h:mm a'),
    },
  };
};

// ─── POST /api/site-bookings ───
// Public (booking page) — live sites only. Thin wrapper over placeBooking.
// Body: { siteId, teamMemberId, serviceId, date (YYYY-MM-DD), time (HH:mm),
//         customer: { firstName, lastName, email, phone }, notes }
const createBooking = async (req, res) => {
  try {
    const r = await placeBooking({ ...req.body, allowedStatuses: ['live'] });
    if (!r.ok) return res.status(r.code).json({ success: false, message: r.message });
    return res.status(r.idempotent ? 200 : 201).json({ success: true, ...(r.idempotent ? { idempotent: true } : {}), booking: r.booking });
  } catch (err) {
    console.error('createBooking error:', err);
    return res.status(500).json({ success: false, message: 'Could not create booking.' });
  }
};

// ─── GET /api/site-bookings/month?siteId=&teamMemberId=&serviceId=&year=YYYY&month=M (1-12) ───
// Returns { availableDates: ["2026-05-26", ...] } — dates with >=1 fitting slot.
const getMonthAvailability = async (req, res) => {
  const { siteId, teamMemberId, serviceId, year, month } = req.query;
  if (!siteId || !teamMemberId || !serviceId || !year || !month) {
    return res.status(400).json({ success: false, message: 'Missing required parameters.' });
  }
  try {
    const { data: site } = await supabase.from('sites').select('id, status, time_zone').eq('id', siteId).single();
    if (!site || site.status !== 'live') return res.status(404).json({ success: false, message: 'Site not available.' });
    const zone = site.time_zone || 'America/New_York';

    const { data: service } = await supabase.from('site_services').select('duration_minutes').eq('id', serviceId).eq('site_id', siteId).single();
    if (!service) return res.status(404).json({ success: false, message: 'Service not found.' });
    const duration = service.duration_minutes || 30;

    const { data: rules } = await supabase.from('site_availability_rules').select('*')
      .eq('team_member_id', teamMemberId).eq('site_id', siteId).eq('is_active', true);

    const monthStart = DateTime.fromObject({ year: +year, month: +month, day: 1 }, { zone });
    if (!monthStart.isValid) return res.status(400).json({ success: false, message: 'Invalid month.' });
    const daysInMonth = monthStart.daysInMonth;
    const now = DateTime.now().setZone(zone);

    // Pull all bookings for this barber in the month once
    const monthEnd = monthStart.plus({ months: 1 });
    const { data: bookings } = await supabase.from('site_bookings').select('starts_at, ends_at, status')
      .eq('team_member_id', teamMemberId).eq('site_id', siteId).neq('status', 'cancelled')
      .gte('starts_at', monthStart.toUTC().toISO()).lt('starts_at', monthEnd.toUTC().toISO());
    const busy = (bookings || []).map(b => ({
      start: DateTime.fromISO(b.starts_at, { zone }),
      end:   DateTime.fromISO(b.ends_at,   { zone }),
    }));

    const availableDates = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const day = monthStart.set({ day: d });
      if (day.endOf('day') < now) continue; // skip past days
      const dow = day.weekday % 7;

      const isOff = (rules || []).some(r => {
        if (r.rule_type !== 'time_off' && r.rule_type !== 'date_override') return false;
        if (!r.start_date) return false;
        const s = DateTime.fromISO(r.start_date, { zone });
        const e = r.end_date ? DateTime.fromISO(r.end_date, { zone }) : s;
        return day >= s.startOf('day') && day <= e.endOf('day');
      });
      if (isOff) continue;

      const windows = (rules || [])
        .filter(r => r.rule_type === 'weekly_recurring' && r.day_of_week === dow && r.start_time && r.end_time)
        .map(r => ({
          start: day.set({ hour: +r.start_time.slice(0, 2), minute: +r.start_time.slice(3, 5) }),
          end:   day.set({ hour: +r.end_time.slice(0, 2),   minute: +r.end_time.slice(3, 5) }),
        }));
      if (windows.length === 0) continue;

      // Does ANY 15-min-grid start fit the duration without overlap?
      let hasSlot = false;
      for (const w of windows) {
        let cursor = w.start;
        while (cursor.plus({ minutes: duration }) <= w.end) {
          const sStart = cursor, sEnd = cursor.plus({ minutes: duration });
          if (sStart >= now && !busy.some(b => sStart < b.end && sEnd > b.start)) {
            hasSlot = true;
            break;
          }
          cursor = cursor.plus({ minutes: SLOT_GRID_MINUTES });
        }
        if (hasSlot) break;
      }
      if (hasSlot) availableDates.push(day.toFormat('yyyy-MM-dd'));
    }
    return res.json({ success: true, availableDates });
  } catch (err) {
    console.error('getMonthAvailability error:', err);
    return res.status(500).json({ success: false, message: 'Could not load month availability.' });
  }
};

// ─── POST /api/site-bookings/group ───
// Body: {
//   siteId,
//   customer: { firstName, lastName, email, phone },
//   notes?,
//   items: [{ serviceId, teamMemberId, date (YYYY-MM-DD), time (HH:mm) }, ...]
// }
// Semantics:
//   - Each item re-checks independently against existing site_bookings (back-to-back is NOT overlap).
//   - Items that pass → succeeded[]; items whose slot is taken → failed[].
//   - If 0 succeed → 409, no group created.
//   - If >0 succeed → create parent group, insert children with group_id, send ONE summary email.
//   - Server does NOT cross-check items against each other (UI must filter same-stylist same-time).
//   - Server does NOT check availability rules (working hours / time off) — the slot-list endpoints do.
const createBookingGroup = async (req, res) => {
  const { siteId, customer, notes, items } = req.body;

  if (!siteId || !customer || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, message: 'Missing required fields.' });
  }
  if (!customer.email && !customer.phone) {
    return res.status(400).json({ success: false, message: 'Please provide an email or phone.' });
  }
  for (const it of items) {
    if (!it.serviceId || !it.teamMemberId || !it.date || !it.time) {
      return res.status(400).json({ success: false, message: 'Each item needs serviceId, teamMemberId, date, time.' });
    }
  }

  try {
    // 1. Site validation
    const { data: site, error: siteErr } = await supabase
      .from('sites').select('id, status, time_zone, owner_contact_id').eq('id', siteId).single();
    if (siteErr || !site) return res.status(404).json({ success: false, message: 'Site not found.' });
    if (site.status !== 'live') return res.status(403).json({ success: false, message: 'Site not live.' });
    const zone = site.time_zone || 'America/New_York';

    // 2. Hydrate each item with service details + computed start/end
    const hydrated = [];
    for (const it of items) {
      const { data: svc, error: svcErr } = await supabase
        .from('site_services')
        .select('id, name, duration_minutes, price_cents, currency')
        .eq('id', it.serviceId).eq('site_id', siteId).single();
      if (svcErr || !svc) {
        return res.status(404).json({ success: false, message: `Service not found: ${it.serviceId}` });
      }
      const duration = svc.duration_minutes || 30;
      const startsAt = DateTime.fromISO(`${it.date}T${it.time}`, { zone });
      if (!startsAt.isValid) {
        return res.status(400).json({ success: false, message: `Invalid date/time for ${svc.name?.en || 'item'}.` });
      }
      const endsAt = startsAt.plus({ minutes: duration });

      hydrated.push({
        ...it,
        service: svc,
        duration,
        startsAt,
        endsAt,
        priceCents: svc.price_cents || 0,
        currency: svc.currency || 'USD',
      });
    }

    // 3a. Self-conflict pre-check: items in the basket overlapping each other on the same stylist.
    // Same back-to-back rule as the DB check (sStart < otherEnd && sEnd > otherStart).
    const succeeded = [];
    const failed = [];
    const selfConflictIdx = new Set();
    for (let i = 0; i < hydrated.length; i++) {
      if (selfConflictIdx.has(i)) continue;
      for (let j = i + 1; j < hydrated.length; j++) {
        if (selfConflictIdx.has(j)) continue;
        const a = hydrated[i];
        const b = hydrated[j];
        if (a.teamMemberId !== b.teamMemberId) continue;
        const overlap = a.startsAt < b.endsAt && a.endsAt > b.startsAt;
        if (overlap) {
          // Move BOTH conflicting items to failed[] — neither is "the right one to keep".
          selfConflictIdx.add(i);
          selfConflictIdx.add(j);
        }
      }
    }
    for (let i = 0; i < hydrated.length; i++) {
      if (selfConflictIdx.has(i)) {
        const h = hydrated[i];
        failed.push({
          serviceId: h.serviceId,
          teamMemberId: h.teamMemberId,
          date: h.date,
          time: h.time,
          serviceName: h.service.name,
          reason: 'self_conflict',
        });
      }
    }

    // 3b. Per-item conflict check vs existing site_bookings (back-to-back NOT overlap).
    for (let i = 0; i < hydrated.length; i++) {
      if (selfConflictIdx.has(i)) continue;
      const h = hydrated[i];
      const dayStart = h.startsAt.startOf('day');
      const dayEnd = dayStart.plus({ days: 1 });

      const { data: clashes } = await supabase
        .from('site_bookings').select('id, starts_at, ends_at')
        .eq('team_member_id', h.teamMemberId).eq('site_id', siteId).neq('status', 'cancelled')
        .gte('starts_at', dayStart.toUTC().toISO())
        .lt('starts_at', dayEnd.toUTC().toISO());

      const conflict = (clashes || []).some(b => {
        const bs = DateTime.fromISO(b.starts_at, { zone });
        const be = DateTime.fromISO(b.ends_at, { zone });
        return h.startsAt < be && h.endsAt > bs;
      });

      if (conflict) {
        failed.push({
          serviceId: h.serviceId,
          teamMemberId: h.teamMemberId,
          date: h.date,
          time: h.time,
          serviceName: h.service.name,
          reason: 'slot_taken',
        });
      } else {
        succeeded.push(h);
      }
    }

    // 4. If nothing survives → 409 with failure list, no group created.
    if (succeeded.length === 0) {
      return res.status(409).json({
        success: false,
        message: 'All selected times were just taken. Please pick new times.',
        failed,
      });
    }

    // 5. Upsert customer.
    let customerId = null;
    if (customer.email) {
      const { data: existing } = await supabase
        .from('site_customers').select('id').eq('site_id', siteId)
        .eq('email', customer.email.trim().toLowerCase()).maybeSingle();
      if (existing) customerId = existing.id;
    }
    if (!customerId) {
      const { data: newCust, error: custErr } = await supabase
        .from('site_customers').insert([{
          site_id: siteId,
          first_name: customer.firstName?.trim() || null,
          last_name:  customer.lastName?.trim() || null,
          email:      customer.email?.trim().toLowerCase() || null,
          phone:      customer.phone?.trim() || null,
        }]).select().single();
      if (custErr) throw custErr;
      customerId = newCust.id;
    }

    // 6. Group totals from succeeded[].
    const groupStartsAt = succeeded.reduce((min, h) => h.startsAt < min ? h.startsAt : min, succeeded[0].startsAt);
    const groupEndsAt   = succeeded.reduce((max, h) => h.endsAt   > max ? h.endsAt   : max, succeeded[0].endsAt);
    const totalDuration = succeeded.reduce((s, h) => s + h.duration, 0);
    const totalAmount   = succeeded.reduce((s, h) => s + h.priceCents, 0);
    const groupCurrency = succeeded[0].currency;

    // 7. Create the parent group.
    const { data: group, error: groupErr } = await supabase
      .from('site_booking_groups').insert([{
        site_id: siteId,
        customer_id: customerId,
        starts_at: groupStartsAt.toUTC().toISO(),
        ends_at:   groupEndsAt.toUTC().toISO(),
        total_duration_minutes: totalDuration,
        total_amount_cents: totalAmount,
        currency: groupCurrency,
        service_count: succeeded.length,
        status: 'confirmed',
        customer_notes: notes?.trim() || null,
      }]).select().single();
    if (groupErr) throw groupErr;

    // 8. Insert children. Any individual insert failure moves that item to failed[].
    const booked = [];
    for (const h of succeeded) {
      const { data: row, error: bookErr } = await supabase
        .from('site_bookings').insert([{
          site_id: siteId,
          group_id: group.id,
          customer_id: customerId,
          team_member_id: h.teamMemberId,
          service_id: h.serviceId,
          service_name_snapshot: h.service.name,
          starts_at: h.startsAt.toUTC().toISO(),
          ends_at:   h.endsAt.toUTC().toISO(),
          duration_minutes: h.duration,
          status: 'confirmed',
        }]).select().single();
      if (bookErr) {
        failed.push({
          serviceId: h.serviceId,
          teamMemberId: h.teamMemberId,
          date: h.date,
          time: h.time,
          serviceName: h.service.name,
          reason: 'insert_failed',
        });
      } else {
        booked.push({
          id: row.id,
          serviceId: h.serviceId,
          teamMemberId: h.teamMemberId,
          serviceName: h.service.name,
          date: h.startsAt.toFormat('cccc, LLLL d'),
          time: h.startsAt.toFormat('h:mm a'),
          durationMinutes: h.duration,
          priceCents: h.priceCents,
        });
      }
    }

    // 9. If after insertion nothing actually booked → delete the empty group, 500.
    if (booked.length === 0) {
      await supabase.from('site_booking_groups').delete().eq('id', group.id);
      return res.status(500).json({ success: false, message: 'Could not create bookings.', failed });
    }

    // 10. Recompute group totals if some children failed at insert time.
    if (booked.length < succeeded.length) {
      const actuals = booked.map(b => {
        const src = succeeded.find(s => s.serviceId === b.serviceId && s.teamMemberId === b.teamMemberId);
        return src ? { startsAt: src.startsAt, endsAt: src.endsAt, duration: b.durationMinutes, price: b.priceCents } : null;
      }).filter(Boolean);
      const newStarts = actuals.reduce((min, a) => a.startsAt < min ? a.startsAt : min, actuals[0].startsAt);
      const newEnds   = actuals.reduce((max, a) => a.endsAt   > max ? a.endsAt   : max, actuals[0].endsAt);
      const newDur    = actuals.reduce((s, a) => s + a.duration, 0);
      const newAmt    = actuals.reduce((s, a) => s + a.price, 0);
      await supabase.from('site_booking_groups').update({
        starts_at: newStarts.toUTC().toISO(),
        ends_at:   newEnds.toUTC().toISO(),
        total_duration_minutes: newDur,
        total_amount_cents: newAmt,
        service_count: booked.length,
      }).eq('id', group.id);
    }

    // 11. ONE summary email (best-effort).
    try {
      if (customer.email) {
        const lines = booked.map(b => {
          const price = `$${(b.priceCents / 100).toFixed(0)}`;
          const svcName = b.serviceName?.en || 'Service';
          return `  • ${svcName} — ${b.date} at ${b.time} (${b.durationMinutes} min) — ${price}`;
        }).join('\n');
        const totalLine = `Total: $${(booked.reduce((s,b) => s + b.priceCents, 0) / 100).toFixed(0)}`;
        const failureLines = failed.length > 0
          ? `\n\nUnfortunately, the following could not be booked (the slots were just taken):\n` +
            failed.map(f => `  • ${f.serviceName?.en || 'Service'} — ${f.date} at ${f.time}`).join('\n') +
            `\n\nPlease visit our booking page to pick new times for these.`
          : '';

        const bits = await getTenantEmailBits(siteId);
        await sendMail({
          fromName: 'Maison Lune',
          replyTo: bits.businessEmail || undefined,
          to: customer.email,
          subject: 'Your visit is confirmed',
          text: `Your visit is confirmed.\n\n${lines}\n\n${totalLine}${failureLines}\n\nWe look forward to seeing you.`,
          html: emails.visitConfirmation({
            businessName: 'Maison Lune',
            businessLogoUrl: bits.logoUrl,
            businessUrl: bits.businessUrl,
        businessUrl: bits.businessUrl,
            businessEmail: bits.businessEmail,
            dateLabel: booked[0]?.date || '',
            items: booked.map(b => ({ time: b.time, service: `${b.serviceName?.en || 'Service'} · $${(b.priceCents / 100).toFixed(0)}` })),
            totalLabel: `$${(booked.reduce((s, b) => s + b.priceCents, 0) / 100).toFixed(0)}`,
            failureNote: failed.length > 0
              ? `Some services could not be booked (the slots were just taken): ${failed.map(f => f.serviceName?.en || 'Service').join(', ')}. Please pick new times on the booking page.`
              : null,
          }),
        });
        await supabase.from('site_booking_groups').update({ confirmation_sent_at: new Date().toISOString() }).eq('id', group.id);
      }
    } catch (emailErr) {
      console.error('booking-group confirmation email failed:', emailErr.message);
    }

    // N1: one owner notification for the visit (first booked item carries the summary).
    if (booked[0]?.id) sendOwnerNewBookingEmail(booked[0].id).catch(() => {});

    return res.status(201).json({
      success: true,
      group: {
        id: group.id,
        starts_at: groupStartsAt.toFormat('cccc, LLLL d'),
        ends_at_time: groupEndsAt.toFormat('h:mm a'),
        service_count: booked.length,
        total_amount_cents: booked.reduce((s,b) => s + b.priceCents, 0),
      },
      booked,
      failed,
    });
  } catch (err) {
    console.error('createBookingGroup error:', err);
    return res.status(500).json({ success: false, message: 'Could not create booking group.' });
  }
};

// ─── Class-based booking (Phase 2) ───────────────────────────────────────────
// Classes are site_services with kind='class'. A scheduled occurrence is a
// site_class_sessions row; a class booking is a site_bookings row pointing at the
// session. Spots left = session.capacity − non-cancelled bookings for the session.

// Core: list upcoming open class sessions (no HTTP). Returns { ok, code?, message?,
// zone, sessions:[{id, serviceId, serviceName, instructor, teamMemberId, startsAt,
// date, time, label, capacity, spotsLeft, location}] }.
const listClassSessions = async ({ siteId, serviceId, days = 21, allowedStatuses = ['live'] }) => {
  if (!siteId) return { ok: false, code: 400, message: 'Missing siteId.' };
  const { data: site } = await supabase.from('sites').select('id, status, time_zone').eq('id', siteId).single();
  if (!site) return { ok: false, code: 404, message: 'Site not found.' };
  if (!allowedStatuses.includes(site.status)) return { ok: false, code: 403, message: 'Site not live.' };
  const zone = site.time_zone || 'America/New_York';
  const now = DateTime.now().setZone(zone);
  const until = now.plus({ days });

  let q = supabase.from('site_class_sessions')
    .select('id, service_id, team_member_id, starts_at, ends_at, capacity, status, location, service:site_services(name, kind), instructor:site_team_members(name)')
    .eq('site_id', siteId).eq('status', 'scheduled')
    .gte('starts_at', now.toUTC().toISO()).lt('starts_at', until.toUTC().toISO())
    .order('starts_at');
  if (serviceId) q = q.eq('service_id', serviceId);
  const { data: sessions } = await q;

  const ids = (sessions || []).map((s) => s.id);
  const counts = {};
  if (ids.length) {
    const { data: bks } = await supabase.from('site_bookings')
      .select('class_session_id').in('class_session_id', ids).neq('status', 'cancelled');
    for (const b of (bks || [])) counts[b.class_session_id] = (counts[b.class_session_id] || 0) + 1;
  }

  const out = (sessions || []).map((s) => {
    const start = DateTime.fromISO(s.starts_at, { zone });
    return {
      id: s.id, serviceId: s.service_id, serviceName: en(s.service?.name),
      instructor: s.instructor?.name || null, teamMemberId: s.team_member_id,
      startsAt: s.starts_at, endsAt: s.ends_at,
      date: start.toFormat('yyyy-MM-dd'), time: start.toFormat('HH:mm'),
      label: start.toFormat('ccc, LLL d · h:mm a'),
      capacity: s.capacity, spotsLeft: Math.max(0, (s.capacity || 0) - (counts[s.id] || 0)),
      location: s.location || null,
    };
  });
  return { ok: true, zone, sessions: out };
};

// Core: reserve a spot in a class session. Returns { ok, code?, message?, idempotent?, booking }.
const bookClassSession = async ({ siteId, sessionId, customer, notes, paymentIntentId, allowedStatuses = ['live'], emailFromName = 'Bookings' }) => {
  if (!siteId || !sessionId || !customer) return { ok: false, code: 400, message: 'Missing required fields.' };
  if (!customer.email && !customer.phone) return { ok: false, code: 400, message: 'Please provide an email or phone.' };

  const { data: site } = await supabase.from('sites').select('id, status, time_zone').eq('id', siteId).single();
  if (!site) return { ok: false, code: 404, message: 'Site not found.' };
  if (!allowedStatuses.includes(site.status)) return { ok: false, code: 403, message: 'Site not live.' };
  const zone = site.time_zone || 'America/New_York';

  const { data: s } = await supabase.from('site_class_sessions')
    .select('id, service_id, team_member_id, starts_at, ends_at, capacity, status, service:site_services(name)')
    .eq('id', sessionId).eq('site_id', siteId).single();
  if (!s) return { ok: false, code: 404, message: 'Class not found.' };
  if (s.status !== 'scheduled') return { ok: false, code: 409, message: 'That class is no longer available.' };

  const { count } = await supabase.from('site_bookings')
    .select('id', { count: 'exact', head: true }).eq('class_session_id', sessionId).neq('status', 'cancelled');
  if ((count || 0) >= s.capacity) return { ok: false, code: 409, message: 'That class is full.' };

  // Payment verification (parity with placeBooking) — confirm the PI succeeded +
  // matches this site/service before writing a paid booking. Idempotent on the PI.
  let paymentFields = { payment_status: 'none', stripe_payment_intent_id: null, amount_cents: null, application_fee_cents: null };
  if (paymentIntentId) {
    if (!stripe) return { ok: false, code: 503, message: 'Payments are not configured.' };
    const { data: dupePI } = await supabase
      .from('site_bookings').select('id, starts_at').eq('stripe_payment_intent_id', paymentIntentId).maybeSingle();
    if (dupePI) {
      const ds = DateTime.fromISO(dupePI.starts_at, { zone });
      return { ok: true, code: 200, idempotent: true, booking: { id: dupePI.id, date: ds.toFormat('cccc, LLLL d'), time: ds.toFormat('h:mm a') } };
    }
    let pi;
    try { pi = await stripe.paymentIntents.retrieve(paymentIntentId); }
    catch { return { ok: false, code: 400, message: 'Payment could not be verified.' }; }
    if (!pi || pi.status !== 'succeeded') return { ok: false, code: 402, message: 'Payment not completed.' };
    if (pi.metadata?.site_id !== siteId || pi.metadata?.service_id !== s.service_id) {
      return { ok: false, code: 400, message: 'Payment does not match this class.' };
    }
    paymentFields = {
      payment_status: 'paid', stripe_payment_intent_id: paymentIntentId,
      amount_cents: pi.amount, application_fee_cents: pi.application_fee_amount ?? null,
    };
  }

  // Upsert customer (match by email within the site).
  let customerId = null;
  if (customer.email) {
    const { data: existing } = await supabase.from('site_customers')
      .select('id, metadata').eq('site_id', siteId).eq('email', customer.email.trim().toLowerCase()).maybeSingle();
    if (existing) {
      if (existing.metadata?.suspended) return { ok: false, code: 403, message: 'This account is suspended. Please contact us.' };
      customerId = existing.id;
    }
  }
  if (!customerId) {
    const { data: nc, error } = await supabase.from('site_customers').insert([{
      site_id: siteId,
      first_name: customer.firstName?.trim() || null, last_name: customer.lastName?.trim() || null,
      email: customer.email?.trim().toLowerCase() || null, phone: customer.phone?.trim() || null,
    }]).select().single();
    if (error) return { ok: false, code: 500, message: error.message };
    customerId = nc.id;
  }

  const start = DateTime.fromISO(s.starts_at, { zone });
  const end = DateTime.fromISO(s.ends_at, { zone });

  // Already booked into this session → idempotent.
  const { data: dupe } = await supabase.from('site_bookings')
    .select('id').eq('class_session_id', sessionId).eq('customer_id', customerId).neq('status', 'cancelled').maybeSingle();
  if (dupe) return { ok: true, idempotent: true, booking: { id: dupe.id, date: start.toFormat('cccc, LLLL d'), time: start.toFormat('h:mm a') } };

  const { data: booking, error: bErr } = await supabase.from('site_bookings').insert([{
    site_id: siteId, customer_id: customerId, team_member_id: s.team_member_id, service_id: s.service_id,
    class_session_id: sessionId, service_name_snapshot: s.service?.name,
    starts_at: s.starts_at, ends_at: s.ends_at,
    duration_minutes: Math.max(1, Math.round(end.diff(start, 'minutes').minutes)),
    status: 'confirmed', customer_notes: notes?.trim() || null,
    ...paymentFields,
  }]).select().single();
  if (bErr) return { ok: false, code: 500, message: bErr.message };

  try {
    if (customer.email) {
      const bits = await getTenantEmailBits(siteId);
      await sendMail({
        fromName: emailFromName,
        replyTo: bits.businessEmail || undefined,
        to: customer.email,
        subject: 'Your class is booked',
        text: `You're booked for ${en(s.service?.name)} on ${start.toFormat('cccc, LLLL d')} at ${start.toFormat('h:mm a')}.\n\nSee you there!`,
        html: emails.classConfirmation({
          businessName: emailFromName,
          businessLogoUrl: bits.logoUrl,
        businessUrl: bits.businessUrl,
          businessEmail: bits.businessEmail,
          serviceName: en(s.service?.name) || 'Class',
          dateLabel: start.toFormat('cccc, LLLL d'),
          timeLabel: start.toFormat('h:mm a'),
        }),
      });
      await supabase.from('site_bookings').update({ confirmation_sent_at: new Date().toISOString() }).eq('id', booking.id);
    }
  } catch (emailErr) {
    console.error('class confirmation email failed:', emailErr.message);
  }

  sendOwnerNewBookingEmail(booking.id).catch(() => {});

  return { ok: true, code: 201, booking: { id: booking.id, date: start.toFormat('cccc, LLLL d'), time: start.toFormat('h:mm a') } };
};

// ─── GET /api/site-bookings/class-sessions?siteId=&serviceId= ── public (live only)
const getClassSessions = async (req, res) => {
  try {
    const r = await listClassSessions({ ...req.query, allowedStatuses: ['live'] });
    if (!r.ok) return res.status(r.code).json({ success: false, message: r.message });
    return res.json({ success: true, sessions: r.sessions });
  } catch (err) {
    console.error('getClassSessions error:', err);
    return res.status(500).json({ success: false, message: 'Could not load classes.' });
  }
};

// ─── POST /api/site-bookings/class ── public (live only)
// Body: { siteId, sessionId, customer: { firstName, lastName, email, phone }, notes }
const createClassBooking = async (req, res) => {
  try {
    const r = await bookClassSession({ ...req.body, allowedStatuses: ['live'] });
    if (!r.ok) return res.status(r.code).json({ success: false, message: r.message });
    return res.status(r.idempotent ? 200 : 201).json({ success: true, ...(r.idempotent ? { idempotent: true } : {}), booking: r.booking });
  } catch (err) {
    console.error('createClassBooking error:', err);
    return res.status(500).json({ success: false, message: 'Could not book the class.' });
  }
};

module.exports = {
  getAvailability, createBooking, getMonthAvailability, createBookingGroup,
  getClassSessions, createClassBooking,
  // Cores reused by the Front Desk chat booking tool (lib/frontdeskBooking.js).
  computeAvailability, placeBooking, listClassSessions, bookClassSession,
};
