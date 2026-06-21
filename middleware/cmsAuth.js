// NOTE: config/supabase.js exports the client directly (`module.exports = supabase`),
// not as `{ supabase }`. Using single-var require to match the established convention
// across all other controllers/routes in this server.
const supabase = require('../config/supabase');

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
  return contact?.auth_user_id === authUserId ? site : null;
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

module.exports = { requireCmsAuth, verifySiteOwnership, resolveContactId };
