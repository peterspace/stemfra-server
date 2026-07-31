// Front Desk — changing an existing booking (reschedule / cancel).
//
// IDENTITY IS THE WHOLE PROBLEM HERE. Booking is safe for an anonymous visitor:
// the worst case is a spurious reservation. Changing a booking is not — anyone
// who guessed an email could move or cancel a stranger's class. So this runs
// ONLY for a member the server has verified from their own session, and it
// reuses the member controller's cores rather than reimplementing the ownership,
// status and past-date guards (or forgetting the audit row and the emails).
//
// Scope: RESCHEDULE covers appointments. A class booking is tied to a scheduled
// session, so moving it means picking a different session, not shifting a time —
// we cancel-and-rebook instead of silently moving the clock on a class.

const { DateTime } = require('luxon');
const supabase = require('../config/supabase');
const { computeAvailability } = require('../controllers/bookingController');
const { cancelBookingCore, rescheduleBookingCore } = require('../controllers/siteMembersController');

const ALLOWED = ['live', 'previewing'];
const en = (v) => (typeof v === 'string' ? v : v?.en || '');
const norm = (v) => String(v || '').trim().toLowerCase();

const fmtWhen = (iso, zone) =>
  DateTime.fromISO(iso, { zone }).toFormat("ccc, LLL d 'at' h:mm a");

/** The member's own upcoming, still-changeable bookings on THIS site. */
async function upcomingFor(siteId, customerId) {
  const { data } = await supabase
    .from('site_bookings')
    .select('id, starts_at, service_id, team_member_id, duration_minutes, service_name_snapshot, class_session_id')
    .eq('site_id', siteId).eq('customer_id', customerId).eq('status', 'confirmed')
    .gt('starts_at', new Date().toISOString())
    .order('starts_at')
    .limit(10);
  return data || [];
}

/**
 * @param intent 'reschedule' | 'cancel'
 * @param member resolved by the controller from the visitor's own session, or null
 * @returns { note, card? } in the same shape the booking tool returns
 */
async function runManageTool({ site, member, intent, booking, zone }) {
  const act = norm(intent);
  if (act !== 'reschedule' && act !== 'cancel') return { note: null };

  // Unverified visitor: we cannot act, and we must not pretend otherwise.
  if (!member?.customerId) {
    return {
      note: `BOOKING NOTE: The visitor wants to ${act} a booking but is NOT signed in, so you cannot verify the booking is theirs and must not change anything. In ONE or TWO short sentences: say you can only change a booking once they are signed in, point them to the sign-in link on the site, and offer to pass a message to the team instead. Do NOT ask for a booking reference as a substitute for signing in.`,
    };
  }
  if (member.suspended) {
    return { note: `BOOKING NOTE: This account is suspended. Say briefly that you can't change bookings on this account and they should contact the studio. Nothing else.` };
  }

  const mine = await upcomingFor(site.id, member.customerId);
  if (!mine.length) {
    return { note: `BOOKING NOTE: ${member.name || 'This member'} has no upcoming bookings to ${act}. Say so in one short line and offer to book something instead.` };
  }

  // Which booking? Match what they typed against service name or date, else ask.
  const wanted = norm(booking?.service || booking?.reference || '');
  let target = mine.length === 1 ? mine[0] : null;
  if (!target && wanted) {
    target = mine.find((b) => norm(en(b.service_name_snapshot)).includes(wanted))
      || mine.find((b) => fmtWhen(b.starts_at, zone).toLowerCase().includes(wanted))
      || null;
  }
  if (!target) {
    return {
      note: `BOOKING NOTE: ${member.name || 'The member'} has ${mine.length} upcoming bookings and hasn't said which to ${act}. They are listed for them to tap. In ONE short line ask which one. Do NOT list them in your text.`,
      card: {
        kind: 'options',
        title: act === 'cancel' ? 'Which booking would you like to cancel?' : 'Which booking would you like to move?',
        options: mine.map((b) => ({
          label: en(b.service_name_snapshot) || 'Booking',
          sublabel: fmtWhen(b.starts_at, zone),
          value: `${en(b.service_name_snapshot)} on ${fmtWhen(b.starts_at, zone)}`,
        })),
      },
    };
  }

  const label = en(target.service_name_snapshot) || 'your booking';
  const when = fmtWhen(target.starts_at, zone);

  if (act === 'cancel') {
    if (booking?.confirm !== true) {
      return {
        note: `BOOKING NOTE: A confirmation card for cancelling ${label} on ${when} is shown. In ONE short line ask them to confirm. Set booking.confirm=true ONLY when they say yes.`,
        card: {
          kind: 'booking_confirm',
          title: 'Cancel this booking?',
          lines: [label, when],
          actions: [
            { label: 'Yes, cancel it', value: 'Yes, please cancel that booking.' },
            { label: 'Keep it', value: 'Actually, keep my booking.' },
          ],
        },
      };
    }
    const r = await cancelBookingCore({ bookingId: target.id, member: { id: member.authUserId, email: member.email } });
    if (!r.ok) return { note: `BOOKING NOTE: The cancellation did not go through (${r.message}). Apologise in one short line and offer to pass it to the team.` };
    return {
      note: `BOOKING CONFIRMED: Cancelled ${label} on ${when}. Confirm warmly in ONE short sentence and mention a confirmation email is on the way. Stop collecting details.`,
      card: { kind: 'booking_done', title: 'Booking cancelled', lines: [label, when] },
    };
  }

  // ── reschedule ──
  if (target.class_session_id) {
    return {
      note: `BOOKING NOTE: ${label} on ${when} is a scheduled CLASS, so it can't be moved to a different time — they'd need to cancel it and book the class they want instead. Say that in ONE or TWO short sentences and offer to do both.`,
    };
  }

  const date = typeof booking?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(booking.date.trim()) ? booking.date.trim() : null;
  const time = typeof booking?.time === 'string' && /^\d{1,2}:\d{2}$/.test(booking.time.trim()) ? booking.time.trim() : null;

  if (!date) {
    return { note: `BOOKING NOTE: Moving ${label}, currently ${when}. Ask which DAY they'd like instead (one short line). Don't offer times yet.` };
  }
  if (!time) {
    const avail = await computeAvailability({
      siteId: site.id, teamMemberId: target.team_member_id, serviceId: target.service_id,
      date, allowedStatuses: ALLOWED,
    });
    const slots = avail.ok ? avail.slots : [];
    if (!slots.length) return { note: `BOOKING NOTE: Nothing is free on ${date} for ${label}. Say so in one short line and ask for another day.` };
    return {
      note: `AVAILABLE TIMES to move ${label} to on ${date}: ${slots.slice(0, 8).join(', ')}. Offer ONLY these. Once they pick one, ask them to confirm the move.`,
      quickReplies: slots.slice(0, 6),
    };
  }

  if (booking?.confirm !== true) {
    return {
      note: `BOOKING NOTE: A confirmation card for moving ${label} from ${when} to ${date} ${time} is shown. In ONE short line ask them to confirm. Set booking.confirm=true ONLY when they say yes.`,
      card: {
        kind: 'booking_confirm',
        title: 'Move this booking?',
        lines: [label, `From ${when}`, `To ${fmtWhen(`${date}T${time}`, zone)}`],
        actions: [
          { label: 'Yes, move it', value: 'Yes, please move my booking.' },
          { label: 'Leave it', value: 'Actually, leave it as it is.' },
        ],
      },
    };
  }

  const r = await rescheduleBookingCore({ bookingId: target.id, date, time, member: { id: member.authUserId, email: member.email } });
  if (!r.ok) return { note: `BOOKING NOTE: The move did not go through (${r.message}). Say so in one short line and offer another time.` };
  return {
    note: `BOOKING CONFIRMED: Moved ${label} to ${fmtWhen(r.startsAt, zone)}. Confirm warmly in ONE short sentence and mention a confirmation email is on the way. Stop collecting details.`,
    card: { kind: 'booking_done', title: 'Booking moved', lines: [label, fmtWhen(r.startsAt, zone)] },
  };
}

module.exports = { runManageTool };
