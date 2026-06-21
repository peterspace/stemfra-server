const supabase = require('../config/supabase');
const nodemailer = require('nodemailer');

function createTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  });
}

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
        .select('email, full_name')
        .eq('id', site.owner_contact_id)
        .single();

      if (owner?.email) {
        const transporter = createTransporter();
        await transporter.sendMail({
          from: `"STEMfra Sites" <${process.env.GMAIL_USER}>`,
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

module.exports = { submitSiteLead };
