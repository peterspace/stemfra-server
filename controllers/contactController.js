const supabase = require('../config/supabase');
const { sendMail } = require('../lib/mailer');
const buildNotificationEmail = require('../templates/notificationEmail');
const buildConfirmationEmail = require('../templates/confirmationEmail');
const { fireSpeedToLead } = require('../routes/speedToLead');

// Form subject (label) → leads.service (snake_case) mapping
const SUBJECT_TO_SERVICE = {
  'AI Automation':         'ai_automation',
  'Software Development':  'software_development',
  'Consultancy':           'consultancy',
  'Support':               'support',
  'General':               'general',
};
const ALLOWED_SUBJECTS = Object.keys(SUBJECT_TO_SERVICE);

// Known website template slugs (mirror of stemfra_client/src/app/design/data/boxes.ts).
// Validated server-side so an unknown slug never reaches Supabase as data.
const KNOWN_TEMPLATE_SLUGS = new Set([
  'home', 'table', 'atelier', 'fashion', 'heritage', 'stay',
  'beauty', 'barber', 'learn', 'story', 'fitness', 'studio',
  'suite', 'academic', 'plate',
]);


// ─── POST /api/contact ────────────────────────────────────────────────────────
const submitContact = async (req, res) => {
  const { firstName, lastName, email, company, subject, message, template } = req.body;
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
    // Validate template against the known set. Unknown / missing → null.
    const cleanTemplate = template && KNOWN_TEMPLATE_SLUGS.has(template) ? template : null;

    // Shared fields for insert/update. KYC/KYB: store first/last granular.
    const baseRow = {
      contact_name: contactName, first_name: firstName.trim(), last_name: lastName.trim(),
      email: cleanEmail, service, template_slug: cleanTemplate, last_activity_at: new Date().toISOString(),
    };
    if (cleanCompany) baseRow.company_name = cleanCompany;  // don't null an existing company on re-submit

    // Dedup: reuse a recent, still-open lead with the same email instead of
    // creating a duplicate on re-submit; append the new message to its notes.
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const { data: existing } = await supabase
      .from('leads').select('id, notes').eq('email', cleanEmail)
      .not('stage', 'in', '("won","lost")').gte('created_at', since)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();

    let lead;
    if (existing) {
      const notes = [existing.notes, `— Re-submitted ${new Date().toISOString().slice(0, 10)}:\n${cleanMessage}`].filter(Boolean).join('\n\n');
      const { data: upd, error: upErr } = await supabase
        .from('leads').update({ ...baseRow, notes }).eq('id', existing.id).select().single();
      if (upErr) throw upErr;
      lead = upd;
    } else {
      const { data: ins, error: insertError } = await supabase
        .from('leads')
        .insert([{ ...baseRow, stage: 'new_lead', source: 'website', lead_source: 'website', notes: cleanMessage, notification_sent: false, confirmation_sent: false }])
        .select().single();
      if (insertError) throw insertError;
      lead = ins;
    }

    // Kick off speed-to-lead engagement (fire-and-forget — never block or break
    // the contact-form response). n8n does the SMS/email first-touch + rep notify.
    fireSpeedToLead(lead.id, { source: 'website' })
      .then((r) => { if (!r.ok) console.warn('[contactController] speed-to-lead not started:', r.reason); })
      .catch((e) => console.error('[contactController] speed-to-lead error:', e.message));

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

    const toStemfra = await sendMail({
      fromName: 'STEMfra',
      to:       process.env.NOTIFY_EMAIL,
      subject:  notification.subject,
      html:     notification.html,
      text:     notification.text,
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

      const toUser = await sendMail({
        fromName: 'STEMfra',
        to:       cleanEmail,
        subject:  confirmation.subject,
        html:     confirmation.html,
        text:     confirmation.text,
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
