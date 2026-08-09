// P16.3 support system: owner support tickets + the dogfooded support-call
// config. Tickets live in support_requests (service-role only RLS — owners
// read/write through these endpoints). Calls are booked through OUR OWN
// booking engine against the internal 'stemfra-support' site (its services
// are the call categories), so owner CMS, marketing Concierge, and CRM staff
// all share the same site_bookings rails.
// Single-var supabase import — config/supabase exports the client directly.
const supabase = require('../../config/supabase');
const { verifySiteOwnership, resolveContactId } = require('../../middleware/cmsAuth');
const { logSiteActivity } = require('../../lib/activity');
const { sendMail } = require('../../lib/mailer');

const SUPPORT_SUBDOMAIN = 'stemfra-support';
const CATEGORIES = new Set(['general', 'domain', 'email', 'payments', 'accounts']);

// POST /api/cms/support  { siteId, category, subject, message }
async function createRequest(req, res) {
  try {
    const { siteId, category, subject, message } = req.body || {};
    if (!siteId || !CATEGORIES.has(category) || !subject?.trim() || !message?.trim()) {
      return res.status(400).json({ error: 'siteId, a valid category, subject and message are required.' });
    }
    const site = await verifySiteOwnership(req.cmsUser.id, siteId);
    if (!site) return res.status(403).json({ error: 'You do not own this site.' });

    const contactId = await resolveContactId(req.cmsUser.id);
    const { data: row, error } = await supabase
      .from('support_requests')
      .insert({
        site_id: siteId,
        contact_id: contactId ?? null,
        category,
        subject: subject.trim().slice(0, 200),
        message: message.trim().slice(0, 5000),
      })
      .select()
      .single();
    if (error) throw error;

    logSiteActivity({
      siteId,
      actorName: req.cmsUser.email,
      action: 'support_request_created',
      entityType: 'support_request',
      entityId: row.id,
      details: { category, subject: row.subject },
    });

    // Staff alert — best-effort, never fails the request.
    const to = process.env.SUPPORT_EMAIL || process.env.NOTIFY_EMAIL || process.env.GMAIL_USER;
    if (to) {
      const text = `New support request (${category}) from ${req.cmsUser.email} for ${site.subdomain}.\n\nSubject: ${row.subject}\n\n${row.message}`;
      sendMail({
        fromName: 'Stemfra Support',
        to,
        replyTo: req.cmsUser.email,
        subject: `[Support · ${category}] ${row.subject}`,
        text,
        html: `<p>New support request (<b>${category}</b>) from ${req.cmsUser.email} for <b>${site.subdomain}</b>.</p><p><b>${row.subject}</b></p><p>${row.message.replace(/\n/g, '<br/>')}</p>`,
      }).catch(err => console.error('[support] staff email failed:', err.message));
    }

    return res.json({ request: row });
  } catch (err) {
    console.error('[support] create failed:', err);
    return res.status(500).json({ error: 'Could not create the support request.' });
  }
}

// GET /api/cms/support?siteId=
async function listRequests(req, res) {
  try {
    const { siteId } = req.query;
    if (!siteId) return res.status(400).json({ error: 'siteId is required.' });
    const site = await verifySiteOwnership(req.cmsUser.id, siteId);
    if (!site) return res.status(403).json({ error: 'You do not own this site.' });

    const { data, error } = await supabase
      .from('support_requests')
      .select('id, category, subject, message, status, created_at')
      .eq('site_id', siteId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    return res.json({ requests: data });
  } catch (err) {
    console.error('[support] list failed:', err);
    return res.status(500).json({ error: 'Could not load support requests.' });
  }
}

// GET /api/cms/support/call-config — the internal support site's booking
// coordinates, resolved live by subdomain (never hardcoded ids). The CMS
// books through the PUBLIC booking endpoints with these.
async function callConfig(req, res) {
  try {
    const { data: site, error: siteErr } = await supabase
      .from('sites')
      .select('id, time_zone')
      .eq('subdomain', SUPPORT_SUBDOMAIN)
      .single();
    if (siteErr || !site) return res.status(503).json({ error: 'Support calls are not available right now.' });

    const [{ data: team }, { data: services }] = await Promise.all([
      supabase.from('site_team_members').select('id').eq('site_id', site.id).eq('is_active', true).limit(1),
      supabase
        .from('site_services')
        .select('id, name, duration_minutes, metadata')
        .eq('site_id', site.id)
        .eq('is_active', true)
        .order('display_order'),
    ]);
    if (!team?.length || !services?.length) {
      return res.status(503).json({ error: 'Support calls are not available right now.' });
    }

    return res.json({
      siteId: site.id,
      timeZone: site.time_zone,
      teamMemberId: team[0].id,
      services: services.map(s => ({
        id: s.id,
        category: s.metadata?.support_category ?? 'general',
        name: s.name?.en ?? 'Support call',
        durationMinutes: s.duration_minutes,
      })),
    });
  } catch (err) {
    console.error('[support] call-config failed:', err);
    return res.status(500).json({ error: 'Could not load the call schedule.' });
  }
}

module.exports = { createRequest, listRequests, callConfig };
