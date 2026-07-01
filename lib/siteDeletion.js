// Site deletion lifecycle (P6.26). Soft-delete → 90-day grace → hard purge.
//   • softDeleteSite — detach CF host(s), cancel billing, stamp deleted_at. The
//     site stops serving + disappears from lists; media + rows stay (recoverable).
//   • restoreSite   — clear deleted_at + re-attach the host (within the grace window).
//   • hardPurgeSite — destroy Cloudinary media + delete every site row (IRREVERSIBLE).
//     Called by the sweeper after the grace window, or by staff with force.
// Guardrail: unpaid billing_charges block a (non-forced) delete.
// NOTE: config/supabase.js exports the client directly (single-var require).
const supabase = require('../config/supabase');
const { attachSiteDomain, detachSiteDomain } = require('./attachSiteDomain');
const { deleteSiteCascade } = require('./provisionSite');
const { cloudinary } = require('../config/cloudinary');
const { logSiteActivity } = require('./activity');

const GRACE_DAYS = 90;
const addDays = (iso, n) => new Date(new Date(iso).getTime() + n * 86400000).toISOString();

// Charges that still owe money — block deletion until settled/voided.
async function unpaidChargeCount(siteId) {
  const { count } = await supabase.from('billing_charges')
    .select('id', { count: 'exact', head: true })
    .eq('site_id', siteId).in('status', ['due', 'requested', 'failed']);
  return count || 0;
}

async function softDeleteSite(siteId, { reason = null, by = null, actorName = null, force = false } = {}) {
  const { data: site } = await supabase.from('sites').select('id, deleted_at, subdomain').eq('id', siteId).maybeSingle();
  if (!site) throw new Error('Site not found');
  if (site.deleted_at) throw new Error('This site is already deleted.');

  if (!force) {
    const unpaid = await unpaidChargeCount(siteId);
    if (unpaid > 0) {
      const e = new Error(`This site has ${unpaid} unpaid charge(s). Settle or void them before deleting.`);
      e.code = 'unpaid_charges';
      throw e;
    }
  }

  // Stop serving: detach CF host(s). Best-effort — CF being down never blocks delete.
  let domainDetached = false;
  try { await detachSiteDomain(siteId); domainDetached = true; }
  catch (e) { console.warn('[delete] detach failed', siteId, e.message); }

  // Cancel billing so the cycle sweeper (status='active' only) stops opening charges.
  await supabase.from('subscriptions')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancel_at_period_end: false })
    .eq('site_id', siteId).neq('status', 'cancelled');

  const deletedAt = new Date().toISOString();
  const { error } = await supabase.from('sites')
    .update({ deleted_at: deletedAt, deletion_reason: reason, deletion_initiated_by: by })
    .eq('id', siteId);
  if (error) throw new Error(error.message);

  logSiteActivity({
    siteId, action: 'site_deleted', actorName, entityType: 'site', entityId: siteId,
    details: { reason, domain_detached: domainDetached, grace_days: GRACE_DAYS },
  });
  return { siteId, deletedAt, domainDetached, purgeAfter: addDays(deletedAt, GRACE_DAYS) };
}

async function restoreSite(siteId, { actorName = null } = {}) {
  const { data: site } = await supabase.from('sites').select('id, deleted_at').eq('id', siteId).maybeSingle();
  if (!site) throw new Error('Site not found');
  if (!site.deleted_at) throw new Error('This site is not deleted.');

  const { error } = await supabase.from('sites')
    .update({ deleted_at: null, deletion_reason: null, deletion_initiated_by: null }).eq('id', siteId);
  if (error) throw new Error(error.message);

  let reattached = false;
  try { await attachSiteDomain(siteId); reattached = true; }
  catch (e) { console.warn('[restore] attach failed', siteId, e.message); }

  logSiteActivity({ siteId, action: 'site_restored', actorName, entityType: 'site', entityId: siteId, details: { reattached } });
  return { siteId, reattached };
}

// IRREVERSIBLE. Cloudinary media (best-effort per asset) + the full DB cascade.
async function hardPurgeSite(siteId) {
  const { data: media } = await supabase.from('site_media')
    .select('storage_key, mime_type').eq('site_id', siteId).eq('storage_provider', 'cloudinary');
  let mediaDeleted = 0, mediaFailed = 0;
  for (const m of media || []) {
    if (!m.storage_key) continue;
    const resource_type = (m.mime_type || '').startsWith('video/') ? 'video' : 'image';
    try { await cloudinary.uploader.destroy(m.storage_key, { resource_type }); mediaDeleted++; }
    catch (e) { mediaFailed++; console.warn('[purge] cloudinary destroy failed', m.storage_key, e.message); }
  }
  const { errors } = await deleteSiteCascade(siteId, { bestEffort: true });
  if (errors.length) console.warn('[purge] DB cascade errors for', siteId, '—', errors.join('; '));
  return { siteId, mediaDeleted, mediaFailed, dbErrors: errors };
}

module.exports = { softDeleteSite, restoreSite, hardPurgeSite, unpaidChargeCount, GRACE_DAYS };
