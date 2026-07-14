// NOTE: config/supabase.js exports the client directly (`module.exports = supabase`),
// not as `{ supabase }`. Using single-var require to match the established convention
// across all other controllers/routes in this server.
const supabase = require('../config/supabase');
const { logSiteActivity } = require('../lib/activity');

// ─── Staff mode (Case 4, 2026-07-10) ────────────────────────────────────────
// Stemfra staff (@stemfra.com auth email + ACTIVE `profiles` row — the same gate
// the CRM uses) may operate ANY site from the CMS. The DB layer already allows
// it (`is_stemfra_staff()` RLS); this is the server-endpoint counterpart:
// `verifySiteOwnership` falls back to the staff check when the caller isn't the
// owner, and each staff bypass is AUDITED to site_activity (deduped per
// user+site for 10 minutes so reads don't flood the feed).
const STAFF_TTL_MS = 5 * 60 * 1000;
const staffCache = new Map();   // authUserId → { isStaff, email, at }
const staffAuditSeen = new Map(); // `${authUserId}:${siteId}` → last-logged ts
const STAFF_AUDIT_DEDUP_MS = 10 * 60 * 1000;

async function getStaffInfo(authUserId) {
  if (!authUserId) return { isStaff: false, email: null };
  const hit = staffCache.get(authUserId);
  if (hit && Date.now() - hit.at < STAFF_TTL_MS) return hit;
  let info = { isStaff: false, email: null, at: Date.now() };
  try {
    const { data: userData } = await supabase.auth.admin.getUserById(authUserId);
    const email = userData?.user?.email || null;
    if (email && email.toLowerCase().endsWith('@stemfra.com')) {
      // Legacy client `profiles` rows exist — the email gate above keeps them out.
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, is_active')
        .eq('id', authUserId)
        .maybeSingle();
      info = { isStaff: !!profile?.is_active, email, at: Date.now() };
    } else {
      info = { isStaff: false, email, at: Date.now() };
    }
  } catch (err) {
    console.warn('[cmsAuth] staff check failed (treating as non-staff):', err?.message);
  }
  staffCache.set(authUserId, info);
  return info;
}

function auditStaffAccess(authUserId, email, site) {
  const key = `${authUserId}:${site.id}`;
  const last = staffAuditSeen.get(key);
  if (last && Date.now() - last < STAFF_AUDIT_DEDUP_MS) return;
  staffAuditSeen.set(key, Date.now());
  // Best-effort, fire-and-forget — never blocks the request.
  logSiteActivity({
    siteId: site.id,
    actorName: email || 'Stemfra staff',
    action: 'staff_cms_access',
    details: { subdomain: site.subdomain },
  }).catch(() => {});
}

async function requireCmsAuth(req, res, next) {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
    if (!token) return res.status(401).json({ error: 'Missing authorization header' });

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return res.status(401).json({ error: 'Invalid or expired token' });

    req.cmsUser = { id: data.user.id, email: data.user.email };
    next();
  } catch (err) {
    console.error('[cmsAuth] unexpected:', err);
    res.status(401).json({ error: 'Auth check failed' });
  }
}

async function verifySiteOwnership(authUserId, siteId) {
  if (!authUserId || !siteId) return null;
  const { data: site } = await supabase
    .from('sites')
    .select('id, owner_contact_id, status, subdomain')
    .eq('id', siteId)
    .single();
  if (!site) return null;
  const { data: contact } = await supabase
    .from('contacts')
    .select('id, auth_user_id')
    .eq('id', site.owner_contact_id)
    .single();
  if (contact?.auth_user_id === authUserId) return site;

  // Staff mode: active @stemfra.com staff can operate any site (audited).
  const staff = await getStaffInfo(authUserId);
  if (staff.isStaff) {
    auditStaffAccess(authUserId, staff.email, site);
    return site;
  }
  return null;
}

async function resolveContactId(authUserId) {
  if (!authUserId) return null;
  const { data: contact } = await supabase
    .from('contacts')
    .select('id')
    .eq('auth_user_id', authUserId)
    .single();
  return contact?.id || null;
}

module.exports = { requireCmsAuth, verifySiteOwnership, resolveContactId, getStaffInfo };
