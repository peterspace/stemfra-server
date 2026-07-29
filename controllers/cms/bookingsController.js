// CMS owner booking operations. Reads happen client-side (owner RLS); this
// endpoint exists for the ADJUST-AT-DELIVERY flow (task 60), which needs a
// server-side site_activity audit that owners can't write via RLS.
const supabase = require('../../config/supabase'); // single-var import (repo convention)
const { verifySiteOwnership } = require('../../middleware/cmsAuth');
const { logSiteActivity } = require('../../lib/activity');

// PATCH /api/cms/bookings/:bookingId/adjust
// Owner changes the DELIVERED service / price / duration at the point of delivery
// (e.g. booked a facial, on arrival wants nails). Updates service_name_snapshot +
// amount_cents (+ recomputes ends_at when duration changes). Audited to
// site_activity — matters for commission (the meter reads amount_cents, so the
// figure must reflect what was actually delivered).
async function adjustBooking(req, res) {
  const { bookingId } = req.params;
  const { serviceId, serviceName, amountCents, durationMinutes, note } = req.body || {};
  if (!bookingId) return res.status(400).json({ error: 'bookingId required' });

  const { data: booking, error: fErr } = await supabase
    .from('site_bookings')
    .select('id, site_id, starts_at, service_id, service_name_snapshot, amount_cents, duration_minutes')
    .eq('id', bookingId)
    .maybeSingle();
  if (fErr) return res.status(500).json({ error: fErr.message });
  if (!booking) return res.status(404).json({ error: 'Booking not found' });

  const site = await verifySiteOwnership(req.cmsUser.id, booking.site_id);
  if (!site) return res.status(403).json({ error: 'You do not own this site' });

  const patch = {};
  if (serviceId !== undefined) patch.service_id = serviceId; // may be null (custom service)
  if (serviceName !== undefined && serviceName !== null) patch.service_name_snapshot = serviceName;
  if (amountCents !== undefined) {
    patch.amount_cents = amountCents === null ? null : Math.max(0, Math.round(Number(amountCents)));
  }
  if (durationMinutes !== undefined && durationMinutes !== null) {
    const dur = Math.round(Number(durationMinutes));
    if (dur > 0) {
      patch.duration_minutes = dur;
      patch.ends_at = new Date(new Date(booking.starts_at).getTime() + dur * 60_000).toISOString();
    }
  }
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No changes provided' });

  const { data: updated, error: uErr } = await supabase
    .from('site_bookings')
    .update(patch)
    .eq('id', bookingId)
    .select()
    .single();
  if (uErr) return res.status(500).json({ error: uErr.message });

  await logSiteActivity({
    siteId: booking.site_id,
    actorName: req.cmsUser.email,
    action: 'booking_adjusted',
    entityType: 'site_booking',
    entityId: bookingId,
    details: {
      before: {
        service_name: booking.service_name_snapshot,
        amount_cents: booking.amount_cents,
        duration_minutes: booking.duration_minutes,
      },
      after: {
        service_name: patch.service_name_snapshot ?? booking.service_name_snapshot,
        amount_cents: 'amount_cents' in patch ? patch.amount_cents : booking.amount_cents,
        duration_minutes: patch.duration_minutes ?? booking.duration_minutes,
      },
      note: note || null,
    },
  });

  return res.json({ ok: true, booking: updated });
}

module.exports = { adjustBooking };
