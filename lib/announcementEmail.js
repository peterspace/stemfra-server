// Website-announcement blast (Client Growth Engine build 1, 2026-08-27).
// Owner-triggered from the CMS Clients page (typically right after a CSV
// import): every customer with an email who has never been announced gets ONE
// tenant-branded "we have a new website, book online" email carrying the SMS
// opt-in link (the consent collector for the future SMS channel) and the
// standard unsubscribe. Once-ever per customer (stamped at
// site_customers.metadata.lifecycle.announcement_sent_at), so re-running after
// a new import only reaches the new names.
const supabase = require('../config/supabase');
const emails = require('../templates/transactionalEmails');
const { sendMail } = require('./mailer');
const { loadSiteBrand } = require('./bookingEmails');
const { unsubscribeUrl, smsOptInUrl } = require('./emailTokens');

const BATCH_LIMIT = 200; // per call; the CMS shows `remaining` and the owner clicks again

async function stampAnnounced(customerId, prevMeta) {
  const lc = (prevMeta?.lifecycle) || {};
  await supabase.from('site_customers')
    .update({ metadata: { ...(prevMeta || {}), lifecycle: { ...lc, announcement_sent_at: new Date().toISOString() } } })
    .eq('id', customerId);
}

/**
 * @param {string} siteId
 * @param {{ dryRun?: boolean, limit?: number }} opts
 * @returns {{ ok:boolean, error?:string, pending?:number, sent?:number, failed?:number, remaining?:number }}
 */
async function sendWebsiteAnnouncement(siteId, { dryRun = false, limit = BATCH_LIMIT } = {}) {
  const brand = await loadSiteBrand(siteId);
  if (!brand) return { ok: false, error: 'Site not found.' };
  if (brand.site.status !== 'live') return { ok: false, error: 'Publish the site first: the announcement links customers to your live website.' };

  const { data: customers, error } = await supabase
    .from('site_customers')
    .select('id, first_name, email, email_opt_out, metadata')
    .eq('site_id', siteId)
    .not('email', 'is', null)
    .eq('email_opt_out', false)
    .limit(2000);
  if (error) return { ok: false, error: error.message };

  const pending = (customers || []).filter((c) => c.email && !(c.metadata?.lifecycle?.announcement_sent_at));
  if (dryRun) return { ok: true, pending: pending.length };

  let sent = 0;
  let failed = 0;
  for (const c of pending.slice(0, limit)) {
    const ok = await sendMail({
      fromName: brand.businessName,
      to: c.email,
      replyTo: brand.businessEmail,
      subject: `${brand.businessName} has a new website`,
      text: `Hi${c.first_name ? ` ${c.first_name}` : ''}, ${brand.businessName} now has a brand new website. See our services and book your next visit any time at ${brand.businessUrl}. Book: ${brand.bookingUrl}`,
      html: emails.websiteAnnouncement({
        businessName: brand.businessName,
        businessLogoUrl: brand.businessLogoUrl,
        businessUrl: brand.businessUrl,
        businessAccent: brand.businessAccent,
        businessFont: brand.businessFont,
        businessPhotoUrl: brand.businessPhotoUrl,
        firstName: c.first_name || '',
        bookingUrl: brand.bookingUrl,
        siteHost: brand.siteHost,
        unsubscribeUrl: unsubscribeUrl(c.id),
        smsOptInUrl: smsOptInUrl(c.id),
      }),
    });
    if (ok) { sent += 1; await stampAnnounced(c.id, c.metadata); } else { failed += 1; }
  }
  return { ok: true, sent, failed, remaining: Math.max(0, pending.length - limit) };
}

module.exports = { sendWebsiteAnnouncement };
