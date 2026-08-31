// CMS Leads — owner replies to a lead from inside the CMS (2026-08-07).
// The old UX was a mailto: link, which silently does nothing when the owner's
// machine has no mail handler. This sends for real through lib/mailer
// (Resend/Gmail), from the BUSINESS's display name with reply-to = the owner's
// own email, so the visitor's answer lands in the owner's inbox.
//
// Deliberately PERSONAL-PLAIN (no branded template): a reply to an enquiry
// should read like a person wrote it, same convention as outreach mail.
//
// Single-var supabase require per the server convention.
const supabase = require('../../config/supabase');
const { verifySiteOwnership } = require('../../middleware/cmsAuth');
const { sendMail } = require('../../lib/mailer');
const { getConnector, sendViaConnector } = require('../../lib/tenantGmail');
const { logSiteActivity } = require('../../lib/activity');

// POST /api/cms/leads/:id/reply  { siteId, subject, html, text? }
async function replyToLead(req, res) {
  try {
    const { siteId, subject, html, text } = req.body || {};
    const leadId = req.params.id;
    if (!subject || !String(subject).trim()) return res.status(400).json({ error: 'Subject is required.' });
    if (!html || !String(html).trim()) return res.status(400).json({ error: 'Write a message before sending.' });

    const site = await verifySiteOwnership(req.cmsUser.id, siteId);
    if (!site) return res.status(403).json({ error: 'You do not have access to this site.' });

    const { data: lead } = await supabase
      .from('site_leads').select('*').eq('id', leadId).eq('site_id', siteId).maybeSingle();
    if (!lead) return res.status(404).json({ error: 'Lead not found.' });
    if (!lead.email) return res.status(400).json({ error: 'This lead did not leave an email address.' });

    const { data: siteRow } = await supabase
      .from('sites').select('company:companies(name)').eq('id', siteId).single();
    const businessName = siteRow?.company?.name || site.subdomain;

    // Plain-text alternative derived from the html (mailer convention: always both).
    const plain = (text && String(text).trim()) ||
      String(html).replace(/<br\s*\/?>(?=.)/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim();

    // The send IS the point here — unlike best-effort notifications, a failure
    // must surface to the owner, so no fire-and-forget.
    //
    // P24 dual mode: a connected Gmail (site_email_connectors) sends AS the
    // owner's own address; otherwise the platform default (Resend, business
    // display name, reply-to = the owner) applies.
    const connector = await getConnector(siteId);
    if (connector) {
      await sendViaConnector(connector, {
        fromName: businessName,
        to: lead.email,
        subject: String(subject).trim(),
        text: plain,
        html,
      });
    } else {
      await sendMail({
        fromName: businessName,
        to: lead.email,
        replyTo: req.cmsUser.email,
        subject: String(subject).trim(),
        text: plain,
        html,
      });
    }

    const meta = lead.metadata && typeof lead.metadata === 'object' ? { ...lead.metadata } : {};
    meta.replies = [
      ...(Array.isArray(meta.replies) ? meta.replies : []),
      {
        subject: String(subject).trim(), html, sent_at: new Date().toISOString(),
        by: req.cmsUser.email, via: connector ? `gmail:${connector.email}` : 'platform',
      },
    ];
    await supabase.from('site_leads')
      .update({ status: 'replied', replied_at: new Date().toISOString(), metadata: meta })
      .eq('id', leadId);

    logSiteActivity({
      siteId,
      actorName: req.cmsUser.email,
      action: 'lead_replied',
      entityType: 'site_lead',
      entityId: leadId,
      details: { subject: String(subject).trim(), to: lead.email },
    }).catch(() => {});

    res.json({ ok: true });
  } catch (err) {
    console.error('[cms.leads.reply] failed:', err.message);
    res.status(502).json({ error: 'Could not send the reply. Please try again.' });
  }
}

module.exports = { replyToLead };
