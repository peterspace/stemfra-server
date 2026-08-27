// Seasonal holiday greetings (Client Growth Engine build 2, 2026-08-27).
// Four US holidays; each is a per-site toggle with an OWNER-EDITABLE message
// (CMS Notifications → Automated emails → Seasonal greetings; stored at
// site_theme_settings.metadata.seasonal_messages[key] = {enabled, message}).
// Defaults: enabled, with the copy below — keep the default strings in sync
// with stemfra_cms EmailsSection SEASONAL_DEFAULTS.
//
// Sending: an hourly sweep checks each LIVE site's local calendar; on a
// holiday, between 09:00 and 20:00 local, every customer with an email who
// has not opted out gets ONE greeting per holiday per year (stamped at
// site_customers.metadata.lifecycle["seasonal_<key>_<year>"]). Pure care
// message by design: no booking CTA, no discount (the win-back carries those).
const { DateTime } = require('luxon');
const supabase = require('../config/supabase');
const emails = require('../templates/transactionalEmails');
const { sendMail } = require('./mailer');
const { loadSiteBrand } = require('./bookingEmails');
const { unsubscribeUrl } = require('./emailTokens');

const HOLIDAYS = {
  new_year: {
    label: 'New Year',
    heading: 'Happy New Year',
    subject: (biz) => `Happy New Year from ${biz}`,
    message: 'Happy New Year! Thank you for spending part of your year with us. We wish you a bright year ahead and look forward to seeing you again soon.',
  },
  july4: {
    label: '4th of July',
    heading: 'Happy 4th of July',
    subject: (biz) => `Happy 4th of July from ${biz}`,
    message: 'Happy Independence Day! We hope your 4th of July is full of sunshine, good food and great company.',
  },
  thanksgiving: {
    label: 'Thanksgiving',
    heading: 'Happy Thanksgiving',
    subject: (biz) => `Happy Thanksgiving from ${biz}`,
    message: 'Happy Thanksgiving! We are thankful for wonderful customers like you. Enjoy the day with your favorite people.',
  },
  christmas: {
    label: 'Christmas',
    heading: 'Merry Christmas',
    subject: (biz) => `Merry Christmas from ${biz}`,
    message: 'Merry Christmas from all of us! Thank you for being part of our year. We hope your holidays are full of warmth, rest and good company.',
  },
};

// Which holiday (if any) falls on the given LOCAL date.
function holidayForLocalDate(local) {
  const m = local.month;
  const d = local.day;
  if (m === 1 && d === 1) return 'new_year';
  if (m === 7 && d === 4) return 'july4';
  if (m === 12 && d === 25) return 'christmas';
  // Thanksgiving = the 4th Thursday of November, which always falls on the
  // 22nd through the 28th.
  if (m === 11 && local.weekday === 4 && d >= 22 && d <= 28) return 'thanksgiving';
  return null;
}

// Per-site config with defaults (enabled + default copy).
function resolveSeasonal(meta) {
  const stored = (meta && meta.seasonal_messages) || {};
  const out = {};
  for (const [key, def] of Object.entries(HOLIDAYS)) {
    const s = stored[key] || {};
    out[key] = {
      enabled: s.enabled !== false,
      message: (typeof s.message === 'string' && s.message.trim()) ? s.message.trim() : def.message,
    };
  }
  return out;
}

const PER_SITE_BATCH = 400;

async function sweepSeasonal() {
  const { data: themes, error } = await supabase
    .from('site_theme_settings')
    .select('site_id, metadata, site:sites!inner(status, time_zone)')
    .eq('site.status', 'live')
    .limit(2000);
  if (error) { console.error('[seasonal] sites query:', error.message); return 0; }

  let sent = 0;
  for (const t of themes || []) {
    const tz = t.site?.time_zone || 'America/New_York';
    const local = DateTime.now().setZone(tz);
    if (local.hour < 9 || local.hour >= 20) continue; // decent local hours only
    const key = holidayForLocalDate(local);
    if (!key) continue;
    const cfg = resolveSeasonal(t.metadata)[key];
    if (!cfg.enabled) continue;
    sent += await sendSeasonalForSite(t.site_id, key, cfg.message, local.year);
  }
  if (sent) console.log(`[seasonal] greetings → ${sent}`);
  return sent;
}

async function sendSeasonalForSite(siteId, key, message, year) {
  const brand = await loadSiteBrand(siteId);
  if (!brand) return 0;
  const def = HOLIDAYS[key];
  const stampKey = `seasonal_${key}_${year}`;

  const { data: customers, error } = await supabase
    .from('site_customers')
    .select('id, first_name, email, email_opt_out, metadata')
    .eq('site_id', siteId)
    .not('email', 'is', null)
    .eq('email_opt_out', false)
    .limit(2000);
  if (error) { console.error('[seasonal] customers query:', error.message); return 0; }

  const pending = (customers || []).filter((c) => c.email && !(c.metadata?.lifecycle?.[stampKey]));
  let sent = 0;
  for (const c of pending.slice(0, PER_SITE_BATCH)) {
    const ok = await sendMail({
      fromName: brand.businessName,
      to: c.email,
      replyTo: brand.businessEmail,
      subject: def.subject(brand.businessName),
      text: `${def.heading}${c.first_name ? `, ${c.first_name}` : ''}! ${message}`,
      html: emails.seasonalGreeting({
        businessName: brand.businessName,
        businessLogoUrl: brand.businessLogoUrl,
        businessUrl: brand.businessUrl,
        businessAccent: brand.businessAccent,
        businessFont: brand.businessFont,
        businessPhotoUrl: brand.businessPhotoUrl,
        firstName: c.first_name || '',
        heading: def.heading,
        message,
        unsubscribeUrl: unsubscribeUrl(c.id),
      }),
    });
    if (ok) {
      sent += 1;
      const lc = (c.metadata?.lifecycle) || {};
      await supabase.from('site_customers')
        .update({ metadata: { ...(c.metadata || {}), lifecycle: { ...lc, [stampKey]: new Date().toISOString() } } })
        .eq('id', c.id);
    }
  }
  if (sent) console.log(`[seasonal] ${key} → ${sent} for site ${siteId}`);
  return sent;
}

module.exports = { sweepSeasonal, sendSeasonalForSite, holidayForLocalDate, resolveSeasonal, HOLIDAYS };
