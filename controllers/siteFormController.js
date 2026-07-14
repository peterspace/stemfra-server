const supabase = require('../config/supabase');
const emails = require('../templates/transactionalEmails');
const { sendMail } = require('../lib/mailer');
const { cmsMagicLink } = require('../lib/cmsMagicLink');
const { getSiteNotifyPrefs } = require('../lib/notifyPrefs');

// POST /api/site-forms/lead
// Body: { siteId, name, email, phone, subject, message, sourcePage }
// Inserts a site_leads row for the given site (validated to exist + be live),
// using the service-role key (bypasses RLS — server is the trusted gatekeeper).
const submitSiteLead = async (req, res) => {
  const { siteId, name, email, phone, subject, message, sourcePage } = req.body;

  // ─── Validation ───
  if (!siteId || !message || !message.trim()) {
    return res.status(400).json({ success: false, message: 'Missing required fields.' });
  }
  if (email && !/^\S+@\S+\.\S+$/.test(email.trim())) {
    return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
  }
  if (!email && !phone) {
    return res.status(400).json({ success: false, message: 'Please provide an email or phone number.' });
  }

  try {
    // 1. Validate the site exists and is live; fetch owner for notification.
    const { data: site, error: siteError } = await supabase
      .from('sites')
      .select('id, status, owner_contact_id, company_id, subdomain')
      .eq('id', siteId)
      .single();

    if (siteError || !site) {
      return res.status(404).json({ success: false, message: 'Site not found.' });
    }
    if (site.status !== 'live') {
      return res.status(403).json({ success: false, message: 'Site is not accepting submissions.' });
    }

    // 2. Insert the lead (service-role bypasses RLS — intentional; server is trusted).
    const { data: lead, error: insertError } = await supabase
      .from('site_leads')
      .insert([{
        site_id:     siteId,
        name:        name ? name.trim() : null,
        email:       email ? email.trim().toLowerCase() : null,
        phone:       phone ? phone.trim() : null,
        subject:     subject ? subject.trim() : null,
        message:     message.trim(),
        source_page: sourcePage || null,
        status:      'new',
      }])
      .select()
      .single();

    if (insertError) throw insertError;

    // 3. Notify the owner by email (best-effort — never fail the request on email).
    try {
      const { data: owner } = await supabase
        .from('contacts')
        .select('email, full_name, auth_user_id')
        .eq('id', site.owner_contact_id)
        .single();

      const prefs = await getSiteNotifyPrefs(site.id);
      if (owner?.email && prefs.owner_lead) {
        const dashboardUrl = await cmsMagicLink(owner.auth_user_id, '/leads');
        await sendMail({
          fromName: 'STEMfra Sites',
          to: owner.email,
          subject: `New enquiry from your website${subject ? ` — ${subject}` : ''}`,
          text: [
            `You have a new enquiry from your website.`,
            ``,
            `Name: ${name || '(not given)'}`,
            `Email: ${email || '(not given)'}`,
            `Phone: ${phone || '(not given)'}`,
            subject ? `Subject: ${subject}` : '',
            ``,
            `Message:`,
            message.trim(),
          ].filter(Boolean).join('\n'),
          html: emails.ownerLeadNotification({
            name, email, phone,
            subject: subject ? subject.trim() : null,
            message: message.trim(),
            dashboardUrl,
          }),
        });
      }
    } catch (emailErr) {
      console.error('site-lead notification email failed:', emailErr.message);
      // Lead is already saved — do not fail the request.
    }

    return res.status(201).json({ success: true, message: "Thanks — we'll be in touch shortly." });
  } catch (err) {
    console.error('submitSiteLead error:', err);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
};

// POST /api/site-forms/newsletter
// Body: { siteId, email } — footer newsletter signup. Live/previewing sites
// only; duplicate signups return ok silently (never leak list membership).
// Light per-IP+site rate limit (in-memory, per-instance — same convention as
// the public site-chat endpoint).
const newsletterHits = new Map(); // `${ip}:${siteId}` → timestamps
function newsletterRateLimited(ip, siteId) {
  const key = `${ip}:${siteId}`;
  const now = Date.now();
  const hits = (newsletterHits.get(key) || []).filter((ts) => now - ts < 60_000);
  hits.push(now);
  newsletterHits.set(key, hits);
  if (newsletterHits.size > 5000) newsletterHits.clear(); // crude memory cap
  return hits.length > 10;
}

const subscribeNewsletter = async (req, res) => {
  const { siteId, email } = req.body || {};
  const clean = String(email || '').trim().toLowerCase();
  if (!siteId || !/^\S+@\S+\.\S+$/.test(clean)) {
    return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
  }
  if (newsletterRateLimited(req.ip, siteId)) {
    return res.status(429).json({ success: false, message: 'Too many attempts — try again in a minute.' });
  }
  try {
    const { data: site } = await supabase.from('sites').select('id, status').eq('id', siteId).single();
    if (!site) return res.status(404).json({ success: false, message: 'Site not found.' });
    if (!['live', 'previewing'].includes(site.status)) {
      return res.status(403).json({ success: false, message: 'Site is not accepting submissions.' });
    }
    const { error } = await supabase
      .from('site_newsletter_subscribers')
      .insert([{ site_id: siteId, email: clean, source: 'footer' }]);
    // Unique (site_id, lower(email)) → duplicates report success (idempotent).
    if (error && !/duplicate|unique/i.test(error.message)) {
      return res.status(500).json({ success: false, message: 'Could not subscribe — try again.' });
    }
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Could not subscribe — try again.' });
  }
};

module.exports = { submitSiteLead, subscribeNewsletter };
