// Appointment/class reminder sweeper (N1). The reminder_24h_sent_at /
// reminder_2h_sent_at columns have existed since the reschedule arc — this is
// the job that finally SENDS them. Every 5 minutes: confirmed bookings on LIVE
// sites starting within the next 24h whose 24h reminder hasn't gone out get a
// tenant-branded reminder email + a stamp. (The 2h slot is reserved for SMS in
// N3 — a second email 2h out is noise; Mindbody sends one reminder too.)
//
// Rescheduling already resets the stamps, so a moved booking reminds again for
// its new time. Started from index.js alongside the other sweepers.
const supabase = require('../config/supabase');
const { sendReminderEmail } = require('./bookingEmails');
const { activeProvider } = require('./mailer');

const BATCH = 50;

async function sweepOnce() {
  const now = new Date();
  const horizon = new Date(now.getTime() + 24 * 3600 * 1000);
  const { data: due, error } = await supabase
    .from('site_bookings')
    .select('id, starts_at, site:sites!inner(status)')
    .eq('status', 'confirmed')
    .is('reminder_24h_sent_at', null)
    .gt('starts_at', now.toISOString())
    .lte('starts_at', horizon.toISOString())
    .eq('site.status', 'live')
    .limit(BATCH);
  if (error) { console.error('[reminders] query failed:', error.message); return 0; }

  let sent = 0;
  for (const b of due || []) {
    // Stamp FIRST (claim the row) so a crash mid-send can't double-email; a
    // failed send after the stamp costs one missed reminder, not a duplicate.
    const { data: claimed } = await supabase
      .from('site_bookings')
      .update({ reminder_24h_sent_at: new Date().toISOString() })
      .eq('id', b.id)
      .is('reminder_24h_sent_at', null)
      .select('id')
      .maybeSingle();
    if (!claimed) continue; // another instance claimed it
    const ok = await sendReminderEmail(b.id);
    if (ok) sent += 1;
  }
  if (sent) console.log(`[reminders] sent ${sent} reminder(s)`);
  return sent;
}

function startBookingReminderSweeper({ intervalMs = 5 * 60 * 1000 } = {}) {
  if (!activeProvider()) {
    console.warn('[reminders] no email provider configured (Resend/Gmail) — reminder sweeper NOT started');
    return null;
  }
  const timer = setInterval(() => { sweepOnce().catch((e) => console.error('[reminders]', e.message)); }, intervalMs);
  timer.unref?.();
  console.log(`[reminders] booking reminder sweeper started (every ${Math.round(intervalMs / 60000)}m)`);
  return timer;
}

module.exports = { startBookingReminderSweeper, sweepOnce };
