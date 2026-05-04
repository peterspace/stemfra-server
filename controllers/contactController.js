const supabase = require('../config/supabase');
const nodemailer = require('nodemailer');
const buildNotificationEmail = require('../templates/notificationEmail');
const buildConfirmationEmail = require('../templates/confirmationEmail');

// Form subject (label) → leads.service (snake_case) mapping
const SUBJECT_TO_SERVICE = {
  'AI Automation':         'ai_automation',
  'Software Development':  'software_development',
  'Consultancy':           'consultancy',
  'Support':               'support',
  'General':               'general',
};
const ALLOWED_SUBJECTS = Object.keys(SUBJECT_TO_SERVICE);

// ─── Reusable transporter ─────────────────────────────────────────────────────
function createTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });
}

// ─── POST /api/contact ────────────────────────────────────────────────────────
const submitContact = async (req, res) => {
  const { firstName, lastName, email, company, subject, message } = req.body;
  console.log({ doc: req.body });

  if (!firstName || !lastName || !email || !subject || !message) {
    return res.status(400).json({
      success: false,
      message: 'Please fill in all required fields.',
    });
  }

  if (!ALLOWED_SUBJECTS.includes(subject)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid subject selected.',
    });
  }

  if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
    return res.status(400).json({
      success: false,
      message: 'Please enter a valid email address.',
    });
  }

  try {
    // 1. Persist to Supabase `leads`
    const contactName = `${firstName.trim()} ${lastName.trim()}`.trim();
    const cleanEmail  = email.trim().toLowerCase();
    const cleanCompany = company ? company.trim() : null;
    const cleanMessage = message.trim();
    const service     = SUBJECT_TO_SERVICE[subject];

    const { data: lead, error: insertError } = await supabase
      .from('leads')
      .insert([{
        contact_name:       contactName,
        company_name:       cleanCompany,
        email:              cleanEmail,
        service,
        stage:              'new_lead',
        source:             'website',
        lead_source:        'website',
        notes:              cleanMessage,
        last_activity_at:   new Date().toISOString(),
        notification_sent:  false,
        confirmation_sent:  false,
      }])
      .select()
      .single();

    if (insertError) throw insertError;

    const transporter = createTransporter();

    // 2. Internal notification → support@stemfra.com
    const notification = buildNotificationEmail({
      firstName: firstName.trim(),
      lastName:  lastName.trim(),
      email:     cleanEmail,
      company:   cleanCompany || '',
      subject,
      message:   cleanMessage,
      createdAt: lead.created_at,
    });

    const toStemfra = await transporter.sendMail({
      from:    `"STEMfra" <${process.env.GMAIL_USER}>`,
      to:      process.env.NOTIFY_EMAIL,
      subject: notification.subject,
      html:    notification.html,
      text:    notification.text,
    });

    console.log({ toStemfra });
    console.log('updating lead');

    await supabase
      .from('leads')
      .update({ notification_sent: true })
      .eq('id', lead.id);

    // 3. Confirmation email → client
    try {
      const confirmation = buildConfirmationEmail({
        firstName: firstName.trim(),
        subject,
        message: cleanMessage,
      });

      const toUser = await transporter.sendMail({
        from:    `"STEMfra" <${process.env.GMAIL_USER}>`,
        to:      cleanEmail,
        subject: confirmation.subject,
        html:    confirmation.html,
        text:    confirmation.text,
      });

      console.log({ toUser });

      await supabase
        .from('leads')
        .update({ confirmation_sent: true })
        .eq('id', lead.id);
    } catch (confirmErr) {
      // Don't fail the whole request — the lead is saved and the team has been notified.
      console.error('[contactController] Confirmation email failed:', confirmErr.message);
    }

    console.log('success');

    return res.status(201).json({
      success: true,
      message: "Your message has been received. We'll be in touch within one business day.",
    });
  } catch (err) {
    console.error('[contactController] Error:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Something went wrong. Please try again or email us at support@stemfra.com',
    });
  }
};

// ─── GET /api/contact — list website-source leads (internal use) ──────────────
const getContacts = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .eq('source', 'website')
      .order('created_at', { ascending: false });

    if (error) throw error;

    return res.status(200).json({ success: true, count: data.length, data });
  } catch (err) {
    console.error('[contactController] Fetch error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to fetch contacts.' });
  }
};

module.exports = { submitContact, getContacts };
