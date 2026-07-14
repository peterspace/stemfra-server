// CMS booking notifications (N1) — /api/cms/bookings
//
// The CMS mutates bookings CLIENT-SIDE via Supabase (status changes in
// BookingDetailModal, reschedules via useRescheduleBooking). This endpoint is
// the email tail those mutations call AFTER they succeed, so the customer
// hears about owner-made cancellations/reschedules. Best-effort by design —
// the mutation already committed; a failed email must not un-commit it.
const express = require('express');
const supabase = require('../../config/supabase');
const { requireCmsAuth, verifySiteOwnership } = require('../../middleware/cmsAuth');
const { sendCancellationEmails, sendRescheduleEmails, resendConfirmation } = require('../../lib/bookingEmails');
const { sendNoShow } = require('../../lib/lifecycleEmails');

const router = express.Router();
router.use(requireCmsAuth);

// POST /api/cms/bookings/notify { siteId, bookingId, event: 'cancelled'|'rescheduled', oldStartsAt? }
router.post('/notify', async (req, res) => {
  try {
    const { siteId, bookingId, event, oldStartsAt } = req.body || {};
    const site = await verifySiteOwnership(req.cmsUser.id, siteId);
    if (!site) return res.status(403).json({ error: 'You do not have access to this site.' });
    if (!bookingId || !['cancelled', 'rescheduled', 'no_show'].includes(event)) {
      return res.status(400).json({ error: 'bookingId and a valid event are required.' });
    }

    // The booking must belong to the verified site (never email across tenants).
    const { data: b } = await supabase
      .from('site_bookings').select('id, site_id').eq('id', bookingId).maybeSingle();
    if (!b || b.site_id !== siteId) return res.status(404).json({ error: 'Booking not found on this site.' });

    let result;
    if (event === 'cancelled') result = await sendCancellationEmails(bookingId, { cancelledByBusiness: true });
    else if (event === 'rescheduled') result = await sendRescheduleEmails(bookingId, { oldStartsAtISO: oldStartsAt || null });
    else result = { client: await sendNoShow(bookingId) }; // no_show
    res.json({ ok: true, sent: result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/cms/bookings/resend-confirmation { siteId, bookingId }
// Owner tool: re-send the booking/class confirmation to the customer.
router.post('/resend-confirmation', async (req, res) => {
  try {
    const { siteId, bookingId } = req.body || {};
    const site = await verifySiteOwnership(req.cmsUser.id, siteId);
    if (!site) return res.status(403).json({ error: 'You do not have access to this site.' });
    if (!bookingId) return res.status(400).json({ error: 'bookingId is required.' });

    const { data: b } = await supabase
      .from('site_bookings').select('id, site_id').eq('id', bookingId).maybeSingle();
    if (!b || b.site_id !== siteId) return res.status(404).json({ error: 'Booking not found on this site.' });

    const sent = await resendConfirmation(bookingId);
    if (!sent) return res.status(422).json({ error: 'Could not send — the customer has no email on file.' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/cms/bookings/cancel-class-session { siteId, sessionId }
// Owner tool: cancel a whole class session — mark the session + every confirmed
// booking cancelled, and email each enrolled customer. Best-effort emails.
router.post('/cancel-class-session', async (req, res) => {
  try {
    const { siteId, sessionId } = req.body || {};
    const site = await verifySiteOwnership(req.cmsUser.id, siteId);
    if (!site) return res.status(403).json({ error: 'You do not have access to this site.' });
    if (!sessionId) return res.status(400).json({ error: 'sessionId is required.' });

    const { data: session } = await supabase
      .from('site_class_sessions').select('id, site_id, status').eq('id', sessionId).maybeSingle();
    if (!session || session.site_id !== siteId) return res.status(404).json({ error: 'Class session not found on this site.' });

    // Enrolled = confirmed bookings on this session.
    const { data: enrolled } = await supabase
      .from('site_bookings').select('id').eq('class_session_id', sessionId).eq('status', 'confirmed').limit(200);

    let notified = 0;
    for (const bk of enrolled || []) {
      await supabase.from('site_bookings')
        .update({ status: 'cancelled', reminder_24h_sent_at: new Date().toISOString() }) // stamp so no reminder fires for a cancelled slot
        .eq('id', bk.id);
      const r = await sendCancellationEmails(bk.id, { cancelledByBusiness: true });
      if (r?.client) notified += 1;
    }
    await supabase.from('site_class_sessions').update({ status: 'cancelled' }).eq('id', sessionId);

    res.json({ ok: true, cancelled: (enrolled || []).length, notified });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
