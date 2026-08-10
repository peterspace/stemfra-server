// Support-call Meet events (P16.4b). Bookings on the internal
// 'stemfra-support' site ALSO get a Google Calendar event with a Meet link,
// created through lib/googleCalendar (the SA impersonating mark@stemfra.com)
// and inviting the customer — so alongside the branded confirmation email the
// visitor receives a real calendar invite (RSVP + Join with Google Meet), and
// the call lands on the host's calendar automatically. The same host's REAL
// free/busy is subtracted from the support site's availability so a slot only
// shows when both the engine AND the host's calendar are free. Tenant sites
// never touch any of this — every entry point checks the subdomain first.
// Single-var supabase import — config/supabase exports the client directly.
const supabase = require('../config/supabase');
const { DateTime } = require('luxon');
const gc = require('./googleCalendar');

const SUPPORT_SUBDOMAIN = 'stemfra-support';

const isSupportSite = (site) => site?.subdomain === SUPPORT_SUBDOMAIN;

/** Optional co-hosts on every support call (comma-separated emails). */
function extraAttendees() {
  return (process.env.SETUP_CALL_ATTENDEES || '')
    .split(',').map(s => s.trim()).filter(Boolean).map(email => ({ email }));
}

/**
 * After a support-site booking commits: create the Calendar event with Meet,
 * list the customer as a guest (Google does NOT email them — sendUpdates is
 * 'none'; the branded confirmation email + its ICS are the visitor's notice),
 * and stamp the event id + Meet link on the booking's metadata (so a later
 * cancel can delete the event). Never throws — the booking stands even if
 * Google is down. Returns { eventId, meetLink } or null.
 */
async function createSupportCallMeet({ site, booking, service, customer }) {
  if (!isSupportSite(site) || !gc.isConfigured()) return null;
  try {
    const customerName = [customer.firstName, customer.lastName].filter(Boolean).join(' ').trim();
    const svcName = service?.name?.en || 'Stemfra call';
    const { eventId, meetLink } = await gc.createEventWithMeet({
      summary: customerName ? `${svcName} with ${customerName}` : svcName,
      description: `Booked through Stemfra. Booking ${booking.id}.${booking.customer_notes ? `\n\nNotes: ${booking.customer_notes}` : ''}`,
      startIso: booking.starts_at,
      endIso: booking.ends_at,
      timeZone: site.time_zone || 'America/New_York',
      attendees: [{ email: customer.email, name: customerName || undefined }, ...extraAttendees()],
    });
    await supabase
      .from('site_bookings')
      .update({ metadata: { ...(booking.metadata || {}), google_event_id: eventId, meet_link: meetLink } })
      .eq('id', booking.id);
    console.log(`[supportMeet] event ${eventId} created for booking ${booking.id} (${meetLink})`);
  } catch (e) {
    console.error('[supportMeet] event create failed:', e.message);
  }
}

/**
 * Subtract the host's REAL Google busy blocks from engine slots for one day.
 * slots are 'HH:mm' wall-clock strings in the site's zone. Fails open (returns
 * the engine slots unchanged) if the Calendar API is unavailable.
 */
async function filterSlotsByHostBusy({ slots, date, zone, durationMinutes }) {
  if (!gc.isConfigured() || !slots?.length) return slots;
  try {
    const dayStart = DateTime.fromISO(date, { zone }).startOf('day');
    const busy = await gc.queryFreeBusy({
      timeMin: dayStart.toUTC().toISO(),
      timeMax: dayStart.plus({ days: 1 }).toUTC().toISO(),
      calendarIds: [gc.hostEmail()],
    });
    if (!busy.length) return slots;
    const blocks = busy.map(b => ({ start: DateTime.fromISO(b.start), end: DateTime.fromISO(b.end) }));
    return slots.filter(t => {
      const s = DateTime.fromISO(`${date}T${t}`, { zone });
      const e = s.plus({ minutes: durationMinutes });
      return !blocks.some(b => s < b.end && e > b.start);
    });
  } catch (e) {
    console.error('[supportMeet] free/busy filter failed (failing open):', e.message);
    return slots;
  }
}

module.exports = { SUPPORT_SUBDOMAIN, isSupportSite, createSupportCallMeet, filterSlotsByHostBusy };
