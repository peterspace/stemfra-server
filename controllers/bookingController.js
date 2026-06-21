const supabase = require('../config/supabase');
const nodemailer = require('nodemailer');
const { DateTime } = require('luxon');
const { stripe } = require('../config/stripe');

function createTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  });
}

const SLOT_GRID_MINUTES = 15;

// ─── GET /api/site-bookings/availability?siteId=&teamMemberId=&serviceId=&date=YYYY-MM-DD ───
// Returns available start times (HH:mm strings in the site's timezone) for that barber+service+date.
const getAvailability = async (req, res) => {
  const { siteId, teamMemberId, serviceId, date } = req.query;
  if (!siteId || !teamMemberId || !serviceId || !date) {
    return res.status(400).json({ success: false, message: 'Missing required parameters.' });
  }

  try {
    // Site (for timezone + live check)
    const { data: site, error: siteErr } = await supabase
      .from('sites').select('id, status, time_zone').eq('id', siteId).single();
    if (siteErr || !site) return res.status(404).json({ success: false, message: 'Site not found.' });
    if (site.status !== 'live') return res.status(403).json({ success: false, message: 'Site not live.' });

    const zone = site.time_zone || 'America/New_York';

    // Service duration
    const { data: service, error: svcErr } = await supabase
      .from('site_services').select('id, duration_minutes').eq('id', serviceId).eq('site_id', siteId).single();
    if (svcErr || !service) return res.status(404).json({ success: false, message: 'Service not found.' });
    const duration = service.duration_minutes || 30;

    // The target date in the site's zone
    const day = DateTime.fromISO(date, { zone });
    if (!day.isValid) return res.status(400).json({ success: false, message: 'Invalid date.' });
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
    if (isOff) return res.json({ success: true, slots: [], reason: 'off' });

    // Working windows for this weekday (weekly_recurring rules matching dow)
    const windows = (rules || [])
      .filter(r => r.rule_type === 'weekly_recurring' && r.day_of_week === dow && r.start_time && r.end_time)
      .map(r => ({
        start: DateTime.fromISO(`${date}T${r.start_time}`, { zone }),
        end:   DateTime.fromISO(`${date}T${r.end_time}`, { zone }),
      }));
    if (windows.length === 0) return res.json({ success: true, slots: [], reason: 'closed' });

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
    return res.json({ success: true, slots: unique, duration });
  } catch (err) {
    console.error('getAvailability error:', err);
    return res.status(500).json({ success: false, message: 'Could not load availability.' });
  }
};

// ─── POST /api/site-bookings ───
// Body: { siteId, teamMemberId, serviceId, date (YYYY-MM-DD), time (HH:mm),
//         customer: { firstName, lastName, email, phone }, notes }
const createBooking = async (req, res) => {
  const { siteId, teamMemberId, serviceId, date, time, customer, notes, paymentIntentId } = req.body;
  if (!siteId || !teamMemberId || !serviceId || !date || !time || !customer) {
    return res.status(400).json({ success: false, message: 'Missing required fields.' });
  }
  if (!customer.email && !customer.phone) {
    return res.status(400).json({ success: false, message: 'Please provide an email or phone.' });
  }

  try {
    const { data: site, error: siteErr } = await supabase
      .from('sites').select('id, status, time_zone, owner_contact_id').eq('id', siteId).single();
    if (siteErr || !site) return res.status(404).json({ success: false, message: 'Site not found.' });
    if (site.status !== 'live') return res.status(403).json({ success: false, message: 'Site not live.' });

    const zone = site.time_zone || 'America/New_York';

    const { data: service, error: svcErr } = await supabase
      .from('site_services').select('id, name, duration_minutes').eq('id', serviceId).eq('site_id', siteId).single();
    if (svcErr || !service) return res.status(404).json({ success: false, message: 'Service not found.' });
    const duration = service.duration_minutes || 30;

    const startsAt = DateTime.fromISO(`${date}T${time}`, { zone });
    if (!startsAt.isValid) return res.status(400).json({ success: false, message: 'Invalid date/time.' });
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
    if (conflict) return res.status(409).json({ success: false, message: 'That time was just taken. Please pick another.' });

    // Payment verification — when the client paid (PaymentIntent), confirm with
    // Stripe that it actually succeeded before writing a paid booking. Idempotent
    // on the PI id, so a client retry (or a future webhook) never double-creates.
    let paymentFields = { payment_status: 'none', stripe_payment_intent_id: null, amount_cents: null, application_fee_cents: null };
    if (paymentIntentId) {
      if (!stripe) return res.status(503).json({ success: false, message: 'Payments are not configured.' });
      const { data: dupe } = await supabase
        .from('site_bookings').select('id, starts_at').eq('stripe_payment_intent_id', paymentIntentId).maybeSingle();
      if (dupe) {
        const ds = DateTime.fromISO(dupe.starts_at, { zone });
        return res.status(200).json({ success: true, idempotent: true, booking: { id: dupe.id, date: ds.toFormat('cccc, LLLL d'), time: ds.toFormat('h:mm a') } });
      }
      let pi;
      try {
        // Destination-charge PaymentIntents live on the PLATFORM account, so a
        // plain retrieve (no stripeAccount context) is correct.
        pi = await stripe.paymentIntents.retrieve(paymentIntentId);
      } catch { return res.status(400).json({ success: false, message: 'Payment could not be verified.' }); }
      if (!pi || pi.status !== 'succeeded') return res.status(402).json({ success: false, message: 'Payment not completed.' });
      if (pi.metadata?.site_id !== siteId || pi.metadata?.service_id !== serviceId) {
        return res.status(400).json({ success: false, message: 'Payment does not match this booking.' });
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
          return res.status(403).json({ success: false, message: 'This account is suspended. Please contact us.' });
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
      if (custErr) throw custErr;
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
    if (bookErr) throw bookErr;

    // Best-effort confirmation email to the customer
    try {
      if (customer.email) {
        const transporter = createTransporter();
        await transporter.sendMail({
          from: `"Argyle & Sons" <${process.env.GMAIL_USER}>`,
          to: customer.email,
          subject: 'Your appointment is confirmed',
          text: `Your appointment is confirmed for ${startsAt.toFormat('cccc, LLLL d')} at ${startsAt.toFormat('h:mm a')}.\n\nWe look forward to seeing you.`,
        });
        await supabase.from('site_bookings').update({ confirmation_sent_at: new Date().toISOString() }).eq('id', booking.id);
      }
    } catch (emailErr) {
      console.error('booking confirmation email failed:', emailErr.message);
    }

    return res.status(201).json({
      success: true,
      booking: {
        id: booking.id,
        date: startsAt.toFormat('cccc, LLLL d'),
        time: startsAt.toFormat('h:mm a'),
      },
    });
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

        const transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
        });
        await transporter.sendMail({
          from: `"Maison Lune" <${process.env.GMAIL_USER}>`,
          to: customer.email,
          subject: 'Your visit is confirmed',
          text: `Your visit is confirmed.\n\n${lines}\n\n${totalLine}${failureLines}\n\nWe look forward to seeing you.`,
        });
        await supabase.from('site_booking_groups').update({ confirmation_sent_at: new Date().toISOString() }).eq('id', group.id);
      }
    } catch (emailErr) {
      console.error('booking-group confirmation email failed:', emailErr.message);
    }

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

module.exports = { getAvailability, createBooking, getMonthAvailability, createBookingGroup };
