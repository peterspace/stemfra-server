// Per-event notification preferences (N2).
//
// Stored at site_theme_settings.metadata.notifications — a flat map of event →
// boolean. Absent/true = ON (opt-out model: notifications are on by default so a
// new site works without setup). The CMS "Notifications" settings page writes it.
//
// Events:
//   owner_new_booking   — email the owner when a booking is made
//   owner_cancellation  — email the owner when a customer cancels
//   owner_reschedule    — email the owner when a booking is rescheduled
//   owner_lead          — email the owner on a contact-form lead
//   owner_chat_lead     — email the owner on a chat-assistant lead
//   customer_reminder   — send the 24h reminder to the customer
//
// Back-compat: the pre-N2 hidden flag `metadata.notify_owner_bookings` gated the
// owner's new-booking + cancellation emails — honored as the fallback for those
// two events so existing opt-outs keep working until the owner uses the new page.
const supabase = require('../config/supabase');

const DEFAULTS = {
  owner_new_booking: true,
  owner_cancellation: true,
  owner_reschedule: true,
  owner_lead: true,
  owner_chat_lead: true,
  customer_reminder: true,
};

function resolveNotifyPrefs(metadata) {
  const n = (metadata && metadata.notifications) || {};
  const legacyBookings = metadata?.notify_owner_bookings !== false; // old flag, default true
  const on = (k, fallback) => (n[k] !== undefined ? n[k] !== false : fallback);
  return {
    owner_new_booking: on('owner_new_booking', legacyBookings),
    owner_cancellation: on('owner_cancellation', legacyBookings),
    owner_reschedule: on('owner_reschedule', DEFAULTS.owner_reschedule),
    owner_lead: on('owner_lead', DEFAULTS.owner_lead),
    owner_chat_lead: on('owner_chat_lead', DEFAULTS.owner_chat_lead),
    customer_reminder: on('customer_reminder', DEFAULTS.customer_reminder),
  };
}

// Load + resolve for a site (for callers that don't already have theme.metadata,
// e.g. the lead controllers). Best-effort: defaults (all on) on any error.
async function getSiteNotifyPrefs(siteId) {
  try {
    const { data } = await supabase.from('site_theme_settings').select('metadata').eq('site_id', siteId).maybeSingle();
    return resolveNotifyPrefs(data?.metadata);
  } catch {
    return { ...DEFAULTS };
  }
}

module.exports = { resolveNotifyPrefs, getSiteNotifyPrefs, NOTIFY_DEFAULTS: DEFAULTS };
