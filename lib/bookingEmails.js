// Booking lifecycle emails (N1 — see docs/EMAIL_SMS_CATALOG.md).
// One shared context loader + senders for: reminders (the sweeper),
// cancellation + reschedule notifications (client AND owner), and the owner
// new-booking notification. Used by the member self-service endpoints, the CMS
// notify endpoint, the booking controller, and lib/bookingReminderSweeper.
// All best-effort: an email failure never fails the calling operation.
const { DateTime } = require('luxon');
const supabase = require('../config/supabase');
const emails = require('../templates/transactionalEmails');
const { sendMail } = require('./mailer');
const { cmsMagicLink } = require('./cmsMagicLink');
const { resolveNotifyPrefs } = require('./notifyPrefs');
const { unsubscribeUrl } = require('./emailTokens');

const en = (v) => (v && typeof v === 'object' ? (v.en ?? '') : (v || ''));

// The business's public contact email lives on the home page's location_map
// section. Shared by the booking loader and the site-brand loader.
async function resolveBusinessEmail(siteId) {
  const { data: page } = await supabase
    .from('site_pages').select('id').eq('site_id', siteId).eq('slug', 'home').maybeSingle();
  if (!page) return null;
  const { data: secs } = await supabase
    .from('site_sections').select('content')
    .eq('page_id', page.id).eq('section_type', 'location_map').limit(1);
  return secs?.[0]?.content?.email || null;
}

// Just the site-side brand bits (no booking/customer), for customer-based
// lifecycle emails (birthday, anniversary) that aren't tied to a booking.
async function loadSiteBrand(siteId) {
  const { data: site } = await supabase
    .from('sites')
    .select(`id, subdomain, custom_domain, time_zone, status, owner_contact_id,
      company:companies(name),
      owner:contacts!sites_owner_contact_id_fkey(email, auth_user_id)`)
    .eq('id', siteId)
    .maybeSingle();
  if (!site) return null;
  const [{ data: theme }, businessEmail] = await Promise.all([
    supabase.from('site_theme_settings').select('logo_url, metadata').eq('site_id', siteId).maybeSingle(),
    resolveBusinessEmail(siteId),
  ]);
  const tz = site.time_zone || 'America/New_York';
  const siteHost = site.custom_domain || `${site.subdomain}.stemfra.com`;
  return {
    site, tz, siteHost,
    bookingUrl: `https://${siteHost}/book`,
    businessUrl: `https://${siteHost}`,
    businessName: site.company?.name || site.subdomain,
    businessLogoUrl: theme?.logo_url || null,
    businessEmail,
    reviewUrl: theme?.metadata?.review_url || null,
    lifecycleOffers: theme?.metadata?.lifecycle_offers || {},
    ownerEmail: site.owner?.email || null,
    ownerAuthUserId: site.owner?.auth_user_id || null,
  };
}

// Everything the booking emails need, in one load: booking + customer + the
// site's brand bits (business name, logo, public email, tz) + owner email.
async function loadBookingContext(bookingId) {
  const { data: b } = await supabase
    .from('site_bookings')
    .select(`
      id, site_id, starts_at, service_name_snapshot, status, class_session_id, duration_minutes,
      customer:site_customers(id, first_name, last_name, email, phone, email_opt_out),
      team:site_team_members(name, email, notify_bookings),
      site:sites(id, subdomain, custom_domain, time_zone, status, owner_contact_id,
        company:companies(name),
        owner:contacts!sites_owner_contact_id_fkey(email, auth_user_id))
    `)
    .eq('id', bookingId)
    .maybeSingle();
  if (!b || !b.site) return null;

  const [{ data: theme }, businessEmail] = await Promise.all([
    supabase.from('site_theme_settings').select('logo_url, metadata').eq('site_id', b.site.id).maybeSingle(),
    resolveBusinessEmail(b.site.id),
  ]);

  const tz = b.site.time_zone || 'America/New_York';
  const starts = DateTime.fromISO(b.starts_at, { zone: 'utc' }).setZone(tz);
  const siteHost = b.site.custom_domain || `${b.site.subdomain}.stemfra.com`;
  return {
    booking: b,
    siteHost,
    bookingUrl: `https://${siteHost}/book`,
    businessUrl: `https://${siteHost}`,
    businessName: b.site.company?.name || b.site.subdomain,
    businessLogoUrl: theme?.logo_url || null,
    businessEmail,
    // Optional public review link (Google/Yelp) for the N4 review-ask email.
    reviewUrl: theme?.metadata?.review_url || null,
    // Per-email lifecycle discounts (CMS Emails page): {key:{enabled,percent}}.
    lifecycleOffers: theme?.metadata?.lifecycle_offers || {},
    // Per-event owner/customer notification prefs (N2).
    notify: resolveNotifyPrefs(theme?.metadata),
    ownerEmail: b.site.owner?.email || null,
    ownerAuthUserId: b.site.owner?.auth_user_id || null,
    // The assigned team member, and whether they asked to be copied on their
    // own bookings (N2 "copy this team member" — off by default).
    teamMemberName: b.team?.name || null,
    teamMemberEmail: (b.team?.notify_bookings && b.team?.email) ? b.team.email : null,
    customerId: b.customer?.id || null,
    customerOptedOut: !!b.customer?.email_opt_out,
    customerName: [b.customer?.first_name, b.customer?.last_name].filter(Boolean).join(' '),
    customerEmail: b.customer?.email || null,
    customerPhone: b.customer?.phone || null,
    firstName: b.customer?.first_name || null,
    serviceName: en(b.service_name_snapshot) || 'Appointment',
    dateLabel: starts.toFormat('cccc, LLLL d'),
    timeLabel: starts.toFormat('h:mm a'),
    startsAt: starts,
  };
}

// Thin wrapper over the shared mailer (Resend/Gmail by EMAIL_PROVIDER).
async function send({ fromName, to, replyTo, subject, text, html }) {
  return sendMail({ fromName, to, replyTo, subject, text, html });
}

// N2 "copy this team member on their bookings": if the assigned team member
// opted in (teamMemberEmail is only set when notify_bookings + email are both
// present), send them the same owner-style notification. Best-effort.
async function notifyTeamMember(c, event) {
  if (!c.teamMemberEmail) return false;
  try {
    const verb = event === 'cancelled' ? 'cancelled' : 'booked';
    return await send({
      fromName: c.businessName,
      to: c.teamMemberEmail,
      subject: `${event === 'cancelled' ? 'Cancelled' : 'New booking'} — ${c.customerName || 'a customer'}, ${c.dateLabel} ${c.timeLabel}`,
      text: `${c.customerName || 'A customer'} ${verb} ${c.serviceName} with you on ${c.dateLabel} at ${c.timeLabel}.`,
      html: emails.ownerBookingNotification({ event, ...c }),
    });
  } catch (e) { console.error('[bookingEmails.teamMember]', e.message); return false; }
}

// ─── The senders (each returns {client, owner} booleans; never throws) ────────

async function sendCancellationEmails(bookingId, { cancelledByBusiness = false } = {}) {
  const out = { client: false, owner: false };
  try {
    const c = await loadBookingContext(bookingId);
    if (!c) return out;
    try {
      out.client = await send({
        fromName: c.businessName, to: c.customerEmail, replyTo: c.businessEmail,
        subject: 'Your booking has been cancelled',
        text: `Your booking for ${c.serviceName} on ${c.dateLabel} at ${c.timeLabel} has been cancelled.`,
        html: emails.bookingCancelled({ ...c, cancelledByBusiness }),
      });
    } catch (e) { console.error('[bookingEmails.cancel→client]', e.message); }
    try {
      if (c.notify.owner_cancellation && !cancelledByBusiness) {
        const dashboardUrl = await cmsMagicLink(c.ownerAuthUserId, '/bookings');
        out.owner = await send({
          fromName: 'STEMfra Sites', to: c.ownerEmail,
          subject: `Booking cancelled — ${c.customerName || 'a customer'}, ${c.dateLabel}`,
          text: `${c.customerName || 'A customer'} cancelled ${c.serviceName} on ${c.dateLabel} at ${c.timeLabel}.`,
          html: emails.ownerBookingNotification({ event: 'cancelled', ...c, dashboardUrl }),
        });
      }
    } catch (e) { console.error('[bookingEmails.cancel→owner]', e.message); }
    out.teamMember = await notifyTeamMember(c, 'cancelled');
  } catch (e) { console.error('[bookingEmails.cancel]', e.message); }
  return out;
}

async function sendRescheduleEmails(bookingId, { oldStartsAtISO = null } = {}) {
  const out = { client: false };
  try {
    const c = await loadBookingContext(bookingId);
    if (!c) return out;
    let oldDateLabel = null, oldTimeLabel = null;
    if (oldStartsAtISO) {
      const old = DateTime.fromISO(oldStartsAtISO, { zone: 'utc' }).setZone(c.booking.site.time_zone || 'America/New_York');
      oldDateLabel = old.toFormat('cccc, LLLL d');
      oldTimeLabel = old.toFormat('h:mm a');
    }
    out.client = await send({
      fromName: c.businessName, to: c.customerEmail, replyTo: c.businessEmail,
      subject: 'Your booking has a new time',
      text: `Your ${c.serviceName} booking moved to ${c.dateLabel} at ${c.timeLabel}.`,
      html: emails.bookingRescheduled({ ...c, oldDateLabel, oldTimeLabel }),
    });
    // Notify the owner too (N2 owner_reschedule) — unless a business-side
    // reschedule (owner did it themselves in the CMS → oldStartsAtISO passed).
    if (c.notify.owner_reschedule) {
      try {
        const dashboardUrl = await cmsMagicLink(c.ownerAuthUserId, '/bookings');
        out.owner = await send({
          fromName: 'STEMfra Sites', to: c.ownerEmail,
          subject: `Booking rescheduled — ${c.customerName || 'a customer'}, now ${c.dateLabel} ${c.timeLabel}`,
          text: `${c.customerName || 'A customer'}'s ${c.serviceName} moved${oldDateLabel ? ` from ${oldDateLabel} ${oldTimeLabel}` : ''} to ${c.dateLabel} at ${c.timeLabel}.`,
          html: emails.ownerBookingNotification({ event: 'rescheduled', ...c, oldDateLabel, oldTimeLabel, dashboardUrl }),
        });
      } catch (e) { console.error('[bookingEmails.reschedule→owner]', e.message); }
    }
  } catch (e) { console.error('[bookingEmails.reschedule]', e.message); }
  return out;
}

async function sendOwnerNewBookingEmail(bookingId) {
  try {
    const c = await loadBookingContext(bookingId);
    if (!c) return false;
    // Copy the assigned team member if they opted in — independent of whether
    // the OWNER wants new-booking emails.
    const teamMember = await notifyTeamMember(c, 'new');
    if (!c.notify.owner_new_booking) return teamMember;
    const dashboardUrl = await cmsMagicLink(c.ownerAuthUserId, '/bookings');
    return await send({
      fromName: 'STEMfra Sites', to: c.ownerEmail,
      subject: `New booking — ${c.customerName || 'a customer'}, ${c.dateLabel} ${c.timeLabel}`,
      text: `${c.customerName || 'A customer'} booked ${c.serviceName} on ${c.dateLabel} at ${c.timeLabel}.`,
      html: emails.ownerBookingNotification({ event: 'new', ...c, dashboardUrl }),
    });
  } catch (e) { console.error('[bookingEmails.ownerNew]', e.message); return false; }
}

async function sendReminderEmail(bookingId) {
  try {
    const c = await loadBookingContext(bookingId);
    // Skip if reminders are off for the site, no email, or the customer opted out.
    if (!c || !c.customerEmail || !c.notify.customer_reminder || c.customerOptedOut) return false;
    return await send({
      fromName: c.businessName, to: c.customerEmail, replyTo: c.businessEmail,
      subject: `Reminder: ${c.serviceName} ${c.dateLabel === DateTime.now().setZone(c.startsAt.zone).toFormat('cccc, LLLL d') ? 'today' : 'tomorrow'} at ${c.timeLabel}`,
      text: `A reminder about your booking: ${c.serviceName} on ${c.dateLabel} at ${c.timeLabel}. Can't make it? Reply to this email.`,
      html: emails.bookingReminder({ ...c, isClass: false, unsubscribeUrl: unsubscribeUrl(c.customerId) }),
    });
  } catch (e) { console.error('[bookingEmails.reminder]', e.message); return false; }
}

// Owner tool: re-send the confirmation to the customer (e.g. they say they never
// got it). Chooses the class vs appointment confirmation from the booking shape.
async function resendConfirmation(bookingId) {
  try {
    const c = await loadBookingContext(bookingId);
    if (!c || !c.customerEmail) return false;
    const isClass = !!c.booking.class_session_id;
    const html = isClass
      ? emails.classConfirmation({
          businessName: c.businessName, businessLogoUrl: c.businessLogoUrl, businessEmail: c.businessEmail,
          serviceName: c.serviceName, dateLabel: c.dateLabel, timeLabel: c.timeLabel,
        })
      : emails.bookingConfirmation({
          businessName: c.businessName, businessLogoUrl: c.businessLogoUrl, businessEmail: c.businessEmail,
          firstName: c.firstName, serviceName: c.serviceName, dateLabel: c.dateLabel, timeLabel: c.timeLabel,
          durationLabel: c.booking.duration_minutes ? `${c.booking.duration_minutes} min` : null,
        });
    return await send({
      fromName: c.businessName, to: c.customerEmail, replyTo: c.businessEmail,
      subject: isClass ? 'Your class is booked' : 'Your appointment is confirmed',
      text: `Confirming your ${c.serviceName} on ${c.dateLabel} at ${c.timeLabel}.`,
      html,
    });
  } catch (e) { console.error('[bookingEmails.resendConfirmation]', e.message); return false; }
}

module.exports = {
  loadBookingContext,
  loadSiteBrand,
  sendCancellationEmails,
  sendRescheduleEmails,
  sendOwnerNewBookingEmail,
  sendReminderEmail,
  resendConfirmation,
};
