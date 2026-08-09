// P16.3b: staff side of the support system — cross-site ticket list, status
// updates, and the call config for booking a support call ON BEHALF of a
// client (the CRM books through the same public booking engine against the
// internal 'stemfra-support' site, so staff-booked calls land on the same
// calendar with the same confirmation email to the client).
// Single-var supabase import — config/supabase exports the client directly.
const supabase = require('../../config/supabase');
const { logSiteActivity } = require('../../lib/activity');
const { callConfig } = require('../cms/supportController');

const STATUSES = new Set(['open', 'in_progress', 'resolved']);

// GET /api/admin/support?status=  — all sites, newest first.
async function listRequests(req, res) {
  try {
    let q = supabase
      .from('support_requests')
      .select('id, site_id, category, subject, message, status, created_at, site:sites(subdomain, company:companies(name)), contact:contacts(first_name, last_name, email)')
      .order('created_at', { ascending: false })
      .limit(200);
    if (req.query.status && STATUSES.has(req.query.status)) q = q.eq('status', req.query.status);
    const { data, error } = await q;
    if (error) throw error;
    return res.json({ requests: data });
  } catch (err) {
    console.error('[admin support] list failed:', err);
    return res.status(500).json({ error: 'Could not load support requests.' });
  }
}

// PATCH /api/admin/support/:id  { status }
async function updateStatus(req, res) {
  try {
    const { status } = req.body || {};
    if (!STATUSES.has(status)) return res.status(400).json({ error: 'Invalid status.' });
    const { data, error } = await supabase
      .from('support_requests')
      .update({ status })
      .eq('id', req.params.id)
      .select('id, site_id, status, subject')
      .single();
    if (error) throw error;
    logSiteActivity({
      siteId: data.site_id,
      actorName: req.staffUser?.email ?? 'staff',
      action: 'support_request_status_changed',
      entityType: 'support_request',
      entityId: data.id,
      details: { status, subject: data.subject },
    });
    return res.json({ request: data });
  } catch (err) {
    console.error('[admin support] update failed:', err);
    return res.status(500).json({ error: 'Could not update the request.' });
  }
}

module.exports = { listRequests, updateStatus, callConfig };
