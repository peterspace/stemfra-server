// CMS email connector — the P24 dual-mode switch for lead replies:
// default is platform sending (Resend, business display name, reply-to
// the owner); connecting a Gmail here makes replies send AS the owner's
// own address. Gmail only for now; app password tested BEFORE storing.
// Single-var supabase require per the server convention.
const { verifySiteOwnership } = require('../../middleware/cmsAuth');
const { getConnector, saveConnector, deleteConnector, verifyGmailLogin } = require('../../lib/tenantGmail');
const { logSiteActivity } = require('../../lib/activity');

// GET /api/cms/email-connector?siteId=
async function status(req, res) {
  const site = await verifySiteOwnership(req.cmsUser.id, req.query.siteId);
  if (!site) return res.status(403).json({ error: 'You do not have access to this site.' });
  const c = await getConnector(site.id);
  res.json({ connected: !!c, email: c?.email || null, verified_at: c?.verified_at || null });
}

// POST /api/cms/email-connector { siteId, email, appPassword }
async function connect(req, res) {
  try {
    const { siteId, email, appPassword } = req.body || {};
    const site = await verifySiteOwnership(req.cmsUser.id, siteId);
    if (!site) return res.status(403).json({ error: 'You do not have access to this site.' });

    const addr = String(email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (!appPassword || String(appPassword).replace(/\s/g, '').length < 8) {
      return res.status(400).json({ error: 'Enter the 16-character app password from your Google Account.' });
    }

    const check = await verifyGmailLogin(addr, String(appPassword).trim());
    if (!check.ok) return res.status(422).json({ error: check.error });

    await saveConnector(site.id, addr, String(appPassword).trim());
    logSiteActivity({
      siteId: site.id, actorName: req.cmsUser.email, action: 'email_connector_connected',
      entityType: 'site', entityId: site.id, details: { email: addr },
    }).catch(() => {});
    res.json({ ok: true, email: addr });
  } catch (err) {
    console.error('[cms.email-connector] connect failed:', err.message);
    res.status(500).json({ error: 'Could not save the connection. Please try again.' });
  }
}

// DELETE /api/cms/email-connector { siteId }
async function disconnect(req, res) {
  const site = await verifySiteOwnership(req.cmsUser.id, req.body?.siteId);
  if (!site) return res.status(403).json({ error: 'You do not have access to this site.' });
  await deleteConnector(site.id);
  logSiteActivity({
    siteId: site.id, actorName: req.cmsUser.email, action: 'email_connector_disconnected',
    entityType: 'site', entityId: site.id, details: {},
  }).catch(() => {});
  res.json({ ok: true });
}

module.exports = { status, connect, disconnect };
