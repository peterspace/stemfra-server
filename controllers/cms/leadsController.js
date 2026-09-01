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
const { sanitizeEmailHtml } = require('../../lib/emailHtml');
const { suggestLeadReply, refineEmailHtml } = require('../../lib/emailAssist');
const crypto = require('crypto');

async function replyToLead(req, res) {
  try {
    const { siteId, subject, html, text } = req.body || {};
    const leadId = req.params.id;
    if (!subject || !String(subject).trim()) return res.status(400).json({ error: 'Subject is required.' });
    if (!html || !String(html).trim()) return res.status(400).json({ error: 'Write a message before sending.' });

    // Ingest-sanitize (one trust level): our own composer HTML goes through
    // the same server-side allowlist as any stored email HTML — what lands in
    // metadata.replies is safe to inject into the thread view directly.
    const cleanHtml = sanitizeEmailHtml(html);
    if (!cleanHtml) return res.status(400).json({ error: 'Write a message before sending.' });

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
      String(cleanHtml).replace(/<br\s*\/?>(?=.)/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim();

    // The send IS the point here — unlike best-effort notifications, a failure
    // must surface to the owner, so no fire-and-forget.
    //
    // P24 dual mode: a connected Gmail (site_email_connectors) sends AS the
    // owner's own address; otherwise the platform default (Resend, business
    // display name, reply-to = the owner) applies.
    // RFC threading: our own Message-ID per reply; later replies reference the
    // earlier ones so the visitor's mail client shows one conversation.
    const priorIds = (Array.isArray(lead.metadata?.replies) ? lead.metadata.replies : [])
      .map((r) => r.message_id).filter(Boolean);
    const messageId = `<lead-${leadId}-${crypto.randomBytes(6).toString('hex')}@mail.stemfra.com>`;
    const headers = priorIds.length
      ? { 'In-Reply-To': priorIds[priorIds.length - 1], References: priorIds.join(' ') }
      : undefined;

    const connector = await getConnector(siteId);
    if (connector) {
      await sendViaConnector(connector, {
        fromName: businessName,
        to: lead.email,
        subject: String(subject).trim(),
        text: plain,
        html: cleanHtml,
        headers,
        messageId,
      });
    } else {
      await sendMail({
        fromName: businessName,
        to: lead.email,
        replyTo: req.cmsUser.email,
        subject: String(subject).trim(),
        text: plain,
        html: cleanHtml,
        headers,
        messageId,
      });
    }

    const meta = lead.metadata && typeof lead.metadata === 'object' ? { ...lead.metadata } : {};
    meta.replies = [
      ...(Array.isArray(meta.replies) ? meta.replies : []),
      {
        subject: String(subject).trim(), html: cleanHtml, sent_at: new Date().toISOString(),
        by: req.cmsUser.email, via: connector ? `gmail:${connector.email}` : 'platform',
        message_id: messageId,
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

// AI suggested reply for an enquiry (inbox-parity arc). Grounded on the
// enquiry + the owner's prior replies; tenant-voiced (speaks as the business).
async function suggestReply(req, res) {
  try {
    const { siteId } = req.body || {};
    const site = await verifySiteOwnership(req.cmsUser.id, siteId);
    if (!site) return res.status(403).json({ error: 'You do not have access to this site.' });
    const { data: lead } = await supabase
      .from('site_leads').select('*').eq('id', req.params.id).eq('site_id', siteId).maybeSingle();
    if (!lead) return res.status(404).json({ error: 'Lead not found.' });
    const { data: siteRow } = await supabase
      .from('sites').select('company:companies(name)').eq('id', siteId).single();
    const priorReplies = (Array.isArray(lead.metadata?.replies) ? lead.metadata.replies : [])
      .map((r) => String(r.html || '').replace(/<[^>]+>/g, ' '));
    const out = await suggestLeadReply({
      businessName: siteRow?.company?.name || site.subdomain,
      leadName: lead.name,
      leadMessage: lead.message,
      priorReplies,
    });
    if (out.error) return res.status(422).json({ error: out.error });
    res.json(out);
  } catch (err) {
    console.error('[cms.leads.suggest] failed:', err.message);
    res.status(502).json({ error: 'Could not draft a suggestion. Try again.' });
  }
}

// Refine chips (whitelisted server-side; same instruction set as the CRM).
async function refineReply(req, res) {
  try {
    const { siteId, html, instruction } = req.body || {};
    const site = await verifySiteOwnership(req.cmsUser.id, siteId);
    if (!site) return res.status(403).json({ error: 'You do not have access to this site.' });
    const out = await refineEmailHtml(html, instruction);
    if (out.error) return res.status(422).json({ error: out.error });
    res.json(out);
  } catch (err) {
    console.error('[cms.leads.refine] failed:', err.message);
    res.status(502).json({ error: 'Could not refine. Try again.' });
  }
}

module.exports = { replyToLead, suggestReply, refineReply };
