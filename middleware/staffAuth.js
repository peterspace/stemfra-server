// Staff auth for the internal CRM back-office. Two gates:
//   requireStaffAuth        — any ACTIVE Stemfra staff (a profile exists only for
//                             @stemfra.com Workspace accounts, so this = staff).
//                             Use for general CRM-adjacent endpoints.
//   requireStaffRole(...rs) — active staff whose role is in `rs`. Use for the
//                             platform-admin endpoints (sites/templates/billing/…).
// Mirrors is_stemfra_staff() (DB RLS), which is now "active profile exists".
// Functional-role access (sales/finance/support) is shaped in the CRM UI; these
// role sets are the server-side hard boundary for the money/site endpoints.
// Single-var supabase require per convention.
const supabase = require('../config/supabase');

// Role sets for the platform-admin endpoints (keep in sync with the CRM nav).
const PLATFORM_ADMIN = ['super_admin', 'admin', 'manager'];        // templates, billing
const PLATFORM_OPS = ['super_admin', 'admin', 'manager', 'support']; // sites, bookings, payments (support handles client sites)

async function resolveStaff(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
  if (!token) return { status: 401, msg: 'Missing authorization header' };
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return { status: 401, msg: 'Invalid or expired token' };
  const { data: profile } = await supabase
    .from('profiles').select('role, is_active').eq('id', data.user.id).maybeSingle();
  if (!profile || !profile.is_active) return { status: 403, msg: 'Staff access required' };
  return { user: { id: data.user.id, email: data.user.email, role: profile.role } };
}

// Any active staff.
async function requireStaffAuth(req, res, next) {
  try {
    const r = await resolveStaff(req);
    if (r.status) return res.status(r.status).json({ error: r.msg });
    req.staffUser = r.user;
    next();
  } catch (err) {
    console.error('[staffAuth] unexpected:', err);
    res.status(401).json({ error: 'Auth check failed' });
  }
}

// Active staff with a role in the allowed list.
function requireStaffRole(...allowed) {
  return async (req, res, next) => {
    try {
      const r = await resolveStaff(req);
      if (r.status) return res.status(r.status).json({ error: r.msg });
      if (!allowed.includes(r.user.role)) {
        return res.status(403).json({ error: 'You don’t have permission for this.' });
      }
      req.staffUser = r.user;
      next();
    } catch (err) {
      console.error('[staffRole] unexpected:', err);
      res.status(401).json({ error: 'Auth check failed' });
    }
  };
}

module.exports = { requireStaffAuth, requireStaffRole, PLATFORM_ADMIN, PLATFORM_OPS };
