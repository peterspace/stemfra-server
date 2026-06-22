// Staff cross-site OVERSIGHT (Waves 4 + 5): read-only views of bookings and
// memberships/payments across ALL customer sites. Owners still manage their own
// in the CMS; this is the staff bird's-eye view. Staff-gated.
const supabase = require('../../config/supabase');

const i18n = (v) => (v && typeof v === 'object' ? v.en || '' : v || '');
const fullName = (c) => [c?.first_name, c?.last_name].filter(Boolean).join(' ') || c?.email || '—';

// GET /api/admin/bookings?siteId= — recent bookings across all sites.
async function listBookings(req, res) {
  try {
    let q = supabase
      .from('site_bookings')
      .select('id, starts_at, status, payment_status, amount_cents, service_name_snapshot, site:sites(subdomain, company:companies(name)), customer:site_customers(first_name, last_name, email)')
      .order('starts_at', { ascending: false })
      .limit(200);
    if (req.query.siteId) q = q.eq('site_id', req.query.siteId);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const bookings = (data || []).map((b) => ({
      id: b.id,
      startsAt: b.starts_at,
      status: b.status,
      paymentStatus: b.payment_status,
      amountCents: b.amount_cents,
      service: i18n(b.service_name_snapshot),
      business: b.site?.company?.name || b.site?.subdomain || '—',
      subdomain: b.site?.subdomain,
      customer: fullName(b.customer),
    }));
    res.json({ bookings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// GET /api/admin/memberships — native memberships (System B subscriptions)
// across all sites, with a quick MRR summary.
async function listMemberships(req, res) {
  try {
    const { data, error } = await supabase
      .from('site_subscriptions')
      .select('id, status, amount_cents, current_period_end, cancel_at_period_end, site:sites(subdomain, company:companies(name)), customer:site_customers(first_name, last_name, email), product:site_products(name)')
      .order('created_at', { ascending: false })
      .limit(300);
    if (error) throw new Error(error.message);
    const memberships = (data || []).map((s) => ({
      id: s.id,
      status: s.status,
      amountCents: s.amount_cents,
      periodEnd: s.current_period_end,
      cancelAtPeriodEnd: s.cancel_at_period_end,
      business: s.site?.company?.name || s.site?.subdomain || '—',
      customer: fullName(s.customer),
      plan: i18n(s.product?.name) || 'Membership',
    }));
    const active = memberships.filter((m) => m.status === 'active');
    res.json({
      memberships,
      summary: { activeCount: active.length, activeMrrCents: active.reduce((a, m) => a + (m.amountCents || 0), 0) },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { listBookings, listMemberships };
