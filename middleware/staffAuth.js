// Staff auth for the internal CRM back-office (Phase 2e). Mirrors cmsAuth but
// authorizes against is_stemfra_staff() semantics: a `profiles` row with an
// active staff role. Staff act ACROSS all customers (not ownership-scoped),
// so this gate replaces the placeholder STEMFRA_ADMIN_SECRET for CRM-driven
// admin endpoints. Single-var supabase require per convention.
const supabase = require('../config/supabase');

const STAFF_ROLES = ['admin', 'support', 'staff'];

async function requireStaffAuth(req, res, next) {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
    if (!token) return res.status(401).json({ error: 'Missing authorization header' });

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return res.status(401).json({ error: 'Invalid or expired token' });

    // is_stemfra_staff(): profiles.role in (admin|support|staff) AND is_active.
    const { data: profile } = await supabase
      .from('profiles').select('role, is_active').eq('id', data.user.id).maybeSingle();
    if (!profile || !profile.is_active || !STAFF_ROLES.includes(profile.role)) {
      return res.status(403).json({ error: 'Staff access required' });
    }

    req.staffUser = { id: data.user.id, email: data.user.email, role: profile.role };
    next();
  } catch (err) {
    console.error('[staffAuth] unexpected:', err);
    res.status(401).json({ error: 'Auth check failed' });
  }
}

module.exports = { requireStaffAuth };
