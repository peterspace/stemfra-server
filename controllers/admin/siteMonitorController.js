// Site Activity / Performance monitor (ROADMAP task 59 — OBSERVE-ONLY).
// Replaces the rejected auto-dormancy sweep: staff SEE which sites are active /
// quiet and act manually (nudge email, pause via the existing unpublish) —
// nothing automatic ever purges a site (new businesses can take ~8 months to
// rank on Google; a dormant site costs ~$0 marginal, so we keep them).
//
// GET /api/admin/sites/monitor?from=YYYY-MM-DD&to=YYYY-MM-DD
//   → { window: {from,to}, sites: [ per-site metrics ] }
//
// Per site: window metrics (bookings, revenueCents from confirmed/completed
// bookings' amount_cents, leads, frontdesk chats, newsletter signups) +
// all-time bookings + the last-seen timestamps (booking / lead / chat /
// site_activity) collapsed into lastActiveAt.
//
// Aggregation happens IN JS over capped single fetches (site_id + created_at
// + a few columns). Deliberate pre-launch tradeoff: at today's scale (~20
// sites, hundreds of rows) this is one round-trip per table and zero schema
// work; when row counts approach the caps below, move to a SQL aggregate
// (group-by RPC) — the response shape stays the same.
// Single-var supabase require per convention.
const supabase = require('../../config/supabase');

const ZONE = 'stemfra.com';
const CAPS = { bookings: 10000, leads: 10000, activity: 5000, chats: 5000, news: 5000 };

// Revenue counts bookings that stood (confirmed/completed); canceled/no_show
// are excluded from revenue but still count as "activity" for last-seen.
const REVENUE_STATUSES = new Set(['confirmed', 'completed']);

const iso = (d) => d.toISOString();
const maxTs = (...ts) => {
  const real = ts.filter(Boolean).sort();
  return real.length ? real[real.length - 1] : null;
};

function parseWindow(query) {
  const to = query.to ? new Date(`${query.to}T23:59:59.999Z`) : new Date();
  const from = query.from
    ? new Date(`${query.from}T00:00:00.000Z`)
    : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) return null;
  return { from: iso(from), to: iso(to) };
}

async function monitor(req, res) {
  try {
    const win = parseWindow(req.query);
    if (!win) return res.status(400).json({ error: 'Invalid from/to (YYYY-MM-DD, from <= to).' });

    // 1) The site list (non-deleted) — the frame every metric hangs off.
    const { data: siteRows, error: sErr } = await supabase
      .from('sites')
      .select('id, subdomain, custom_domain, status, went_live_at, created_at, company:companies(name), vertical:verticals(slug, display_name), owner:contacts!owner_contact_id(full_name, email)')
      .is('deleted_at', null)
      .order('created_at', { ascending: false });
    if (sErr) throw new Error(sErr.message);

    // 2) Capped single fetches, newest-first so "last seen" survives a cap hit.
    const [bookings, leads, activity, chats, news] = await Promise.all([
      supabase.from('site_bookings').select('site_id, created_at, amount_cents, status')
        .order('created_at', { ascending: false }).limit(CAPS.bookings),
      supabase.from('site_leads').select('site_id, created_at')
        .order('created_at', { ascending: false }).limit(CAPS.leads),
      supabase.from('site_activity').select('site_id, created_at')
        .order('created_at', { ascending: false }).limit(CAPS.activity),
      supabase.from('agent_conversations').select('site_id, created_at, agent')
        .eq('agent', 'frontdesk')
        .order('created_at', { ascending: false }).limit(CAPS.chats),
      supabase.from('site_newsletter_subscribers').select('site_id, created_at')
        .order('created_at', { ascending: false }).limit(CAPS.news),
    ]);
    for (const r of [bookings, leads, activity, chats, news]) {
      if (r.error) throw new Error(r.error.message);
    }

    // 3) Aggregate per site.
    const bySite = new Map();
    const bucket = (id) => {
      if (!bySite.has(id)) {
        bySite.set(id, {
          bookings: 0, bookingsAllTime: 0, revenueCents: 0, leads: 0, chats: 0, subscribers: 0,
          lastBookingAt: null, lastLeadAt: null, lastChatAt: null, lastActivityAt: null,
        });
      }
      return bySite.get(id);
    };
    const inWindow = (t) => t >= win.from && t <= win.to;

    for (const b of bookings.data || []) {
      const m = bucket(b.site_id);
      m.bookingsAllTime += 1;
      m.lastBookingAt = m.lastBookingAt || b.created_at; // newest-first
      if (inWindow(b.created_at)) {
        m.bookings += 1;
        if (REVENUE_STATUSES.has(b.status)) m.revenueCents += b.amount_cents || 0;
      }
    }
    for (const l of leads.data || []) {
      const m = bucket(l.site_id);
      m.lastLeadAt = m.lastLeadAt || l.created_at;
      if (inWindow(l.created_at)) m.leads += 1;
    }
    for (const c of chats.data || []) {
      const m = bucket(c.site_id);
      m.lastChatAt = m.lastChatAt || c.created_at;
      if (inWindow(c.created_at)) m.chats += 1;
    }
    for (const a of activity.data || []) {
      const m = bucket(a.site_id);
      m.lastActivityAt = m.lastActivityAt || a.created_at;
    }
    for (const n of news.data || []) {
      const m = bucket(n.site_id);
      if (inWindow(n.created_at)) m.subscribers += 1;
    }

    const sites = (siteRows || []).map((s) => {
      const m = bySite.get(s.id) || {};
      const lastActiveAt = maxTs(m.lastBookingAt, m.lastLeadAt, m.lastChatAt, m.lastActivityAt);
      return {
        id: s.id,
        business: s.company?.name || s.subdomain,
        vertical: s.vertical?.display_name || s.vertical?.slug || null,
        subdomain: s.subdomain,
        status: s.status,
        liveUrl: `https://${s.subdomain}.${ZONE}`,
        ownerName: s.owner?.full_name || null,
        ownerEmail: s.owner?.email || null,
        createdAt: s.created_at,
        wentLiveAt: s.went_live_at,
        // Window metrics
        bookings: m.bookings || 0,
        revenueCents: m.revenueCents || 0,
        leads: m.leads || 0,
        chats: m.chats || 0,
        subscribers: m.subscribers || 0,
        // Lifetime + freshness
        bookingsAllTime: m.bookingsAllTime || 0,
        lastBookingAt: m.lastBookingAt || null,
        lastLeadAt: m.lastLeadAt || null,
        lastChatAt: m.lastChatAt || null,
        lastActivityAt: m.lastActivityAt || null,
        lastActiveAt,
      };
    });

    res.json({ window: win, sites });
  } catch (err) {
    console.error('[siteMonitor]', err.message);
    res.status(500).json({ error: err.message });
  }
}

module.exports = { monitor };
