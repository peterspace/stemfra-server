// CMS Owner Reports (Task #26 + custom range/PDF/DOCX). A revenue picture for a
// period, plus "for your accountant" exports (CSV · PDF · Word).
//
// The unique angle: since the direct-keys pivot, online payments live in the
// tenant's OWN Stripe (they can pull 1099-K etc. there) — but Task #20
// PAY-AT-VISIT revenue never touches Stripe, so Stemfra is the only place with
// the COMPLETE picture (online + collected in person).
//
// STRICT: reports only — never computes taxes owed (that's tax advice, and
// sales-tax treatment of services varies by state). We show an educational
// set-aside note with a not-tax-advice disclaimer.
const supabase = require('../../config/supabase');
const { verifySiteOwnership } = require('../../middleware/cmsAuth');
const { renderReportPdf } = require('../../lib/reportPdf');
const { renderReportDocx } = require('../../lib/reportDocx');

const en = (v) => (v && typeof v === 'object' ? (v.en ?? '') : (v || '')) || '';
const money = (c) => (c == null ? '' : (c / 100).toFixed(2));
const dayLabel = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

// Period bounds from YYYY-MM-DD query params (UTC day bounds); default = this month.
function periodRange(q) {
  const to = q?.to ? new Date(q.to + 'T23:59:59.999Z') : new Date();
  const from = q?.from
    ? new Date(q.from + 'T00:00:00.000Z')
    : new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
  return { fromIso: from.toISOString(), toIso: to.toISOString() };
}

async function loadBookings(siteId, fromIso, toIso) {
  const { data } = await supabase
    .from('site_bookings')
    .select('id, starts_at, service_name_snapshot, payment_status, amount_cents, status, customer_id, metadata')
    .eq('site_id', siteId)
    .gte('starts_at', fromIso).lte('starts_at', toIso)
    .limit(100000);
  return data || [];
}

// Normalize a subscription charge to a MONTHLY amount (year → /12, week → ×52/12).
function monthlyCents(amount, interval, count) {
  const n = count || 1;
  if (interval === 'year') return Math.round((amount || 0) / (12 * n));
  if (interval === 'week') return Math.round(((amount || 0) * 52) / (12 * n));
  return Math.round((amount || 0) / n); // month / unknown
}

// Active recurring membership run-rate (MRR) + active member count. This is a
// snapshot, NOT period-summed booking revenue — reported as its own line.
async function loadMembershipMrr(siteId) {
  const { data } = await supabase
    .from('site_subscriptions')
    .select('amount_cents, status, plan:site_products(billing_interval, billing_interval_count)')
    .eq('site_id', siteId)
    .in('status', ['active', 'trialing', 'past_due']);
  let mrr = 0;
  for (const s of data || []) {
    mrr += monthlyCents(s.amount_cents, s.plan?.billing_interval, s.plan?.billing_interval_count || 1);
  }
  return { membershipMrrCents: mrr, membershipCount: (data || []).length };
}

// Classify a booking's revenue (basis = appointment date / starts_at):
//   online   → paid via Stripe (collected)
//   atVisit  → Task #20 pay-at-visit: confirmed/completed, unpaid, has an amount
//   refunded → info only, not revenue
//   none     → free $0 / cancelled / pending → excluded
function classify(b) {
  const amt = b.amount_cents || 0;
  if (b.payment_status === 'paid') return { kind: 'online', cents: amt };
  if (b.payment_status === 'refunded') return { kind: 'refunded', cents: amt };
  if (b.payment_status === 'none' && amt > 0 && (b.status === 'confirmed' || b.status === 'completed')) return { kind: 'atVisit', cents: amt };
  return { kind: 'none', cents: 0 };
}
const HOW_PAID = { online: 'Online (card)', atVisit: 'At visit (in person)', refunded: 'Refunded' };

// One model that powers the on-screen report AND every export.
async function buildModel(siteId, fromIso, toIso) {
  const [{ data: site }, bookings, memberships] = await Promise.all([
    supabase.from('sites').select('subdomain, company:companies(name)').eq('id', siteId).maybeSingle(),
    loadBookings(siteId, fromIso, toIso),
    loadMembershipMrr(siteId),
  ]);

  let onlineCents = 0, atVisitCents = 0, refundedCents = 0, onlineCount = 0, atVisitCount = 0;
  let atVisitCollectedCents = 0, atVisitDueCents = 0; // Task #28 — pay-at-visit split
  const svc = new Map();     // name → { name, count, cents }
  const months = new Map();  // 'YYYY-MM' → { month, onlineCents, atVisitCents }
  const custIds = new Set();
  const transactions = [];   // revenue-bearing line items (incl. refunds), date-sorted

  for (const b of bookings) {
    if (b.customer_id) custIds.add(b.customer_id);
    const c = classify(b);
    if (c.kind === 'none') continue;

    // Pay-at-visit: distinguish already-collected (owner marked it) from still-due.
    const collected = c.kind === 'atVisit' && b.metadata?.collected === true;
    const howPaid = c.kind === 'atVisit' ? (collected ? 'At visit — collected' : 'At visit — due') : HOW_PAID[c.kind];

    transactions.push({
      date: String(b.starts_at).slice(0, 10),
      service: en(b.service_name_snapshot) || 'Service',
      howPaid, status: b.status, kind: c.kind, collected, cents: c.cents,
    });

    if (c.kind === 'refunded') { refundedCents += c.cents; continue; }
    if (c.kind === 'online') { onlineCents += c.cents; onlineCount++; }
    else {
      atVisitCents += c.cents; atVisitCount++;
      if (collected) atVisitCollectedCents += c.cents; else atVisitDueCents += c.cents;
    }

    const name = en(b.service_name_snapshot) || 'Service';
    const e = svc.get(name) || { name, count: 0, cents: 0 };
    e.count++; e.cents += c.cents; svc.set(name, e);

    const mk = String(b.starts_at).slice(0, 7);
    const m = months.get(mk) || { month: mk, onlineCents: 0, atVisitCents: 0 };
    if (c.kind === 'online') m.onlineCents += c.cents; else m.atVisitCents += c.cents;
    months.set(mk, m);
  }
  transactions.sort((a, b) => a.date.localeCompare(b.date));

  // New vs returning: of the customers who booked in the period, how many had
  // their FIRST-EVER booking in it.
  let newCustomers = 0, returningCustomers = 0;
  if (custIds.size) {
    const { data: custs } = await supabase.from('site_customers').select('id, first_booked_at').in('id', [...custIds]);
    for (const cu of custs || []) {
      const first = cu.first_booked_at ? new Date(cu.first_booked_at).toISOString() : null;
      if (first && first >= fromIso && first <= toIso) newCustomers++; else returningCustomers++;
    }
  }

  return {
    businessName: site?.company?.name || site?.subdomain || 'Your business',
    subdomain: site?.subdomain || 'site',
    from: fromIso, to: toIso,
    fromLabel: dayLabel(fromIso), toLabel: dayLabel(toIso),
    totalCents: onlineCents + atVisitCents,
    onlineCents, atVisitCents, refundedCents, onlineCount, atVisitCount,
    atVisitCollectedCents, atVisitDueCents,
    membershipMrrCents: memberships.membershipMrrCents, membershipCount: memberships.membershipCount,
    topServices: [...svc.values()].sort((a, b) => b.cents - a.cents).slice(0, 8),
    byMonth: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)),
    customers: { new: newCustomers, returning: returningCustomers, total: custIds.size },
    transactions,
  };
}

// GET /api/cms/reports?siteId=&from=&to=
async function getReport(req, res) {
  try {
    const siteId = req.query?.siteId;
    if (!siteId) return res.status(400).json({ success: false, message: 'Missing siteId.' });
    const site = await verifySiteOwnership(req.cmsUser.id, siteId);
    if (!site) return res.status(403).json({ success: false, message: 'Not your site.' });
    const { fromIso, toIso } = periodRange(req.query);
    const m = await buildModel(siteId, fromIso, toIso);
    // Cap the line items in the JSON payload; exports carry the full set.
    const DISPLAY_CAP = 1000;
    res.json({
      success: true,
      businessName: m.businessName, from: m.from, to: m.to,
      totalCents: m.totalCents, onlineCents: m.onlineCents, atVisitCents: m.atVisitCents,
      refundedCents: m.refundedCents, onlineCount: m.onlineCount, atVisitCount: m.atVisitCount,
      atVisitCollectedCents: m.atVisitCollectedCents, atVisitDueCents: m.atVisitDueCents,
      membershipMrrCents: m.membershipMrrCents, membershipCount: m.membershipCount,
      topServices: m.topServices, byMonth: m.byMonth, customers: m.customers,
      transactions: m.transactions.slice(0, DISPLAY_CAP),
      transactionsTotal: m.transactions.length,
    });
  } catch (err) {
    console.error('[reports.getReport]', err.message);
    res.status(500).json({ success: false, message: 'Could not build the report.' });
  }
}

function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function reportCsv(m) {
  const lines = [['Date', 'Service', 'Amount', 'How paid', 'Status'].join(',')];
  for (const t of m.transactions) {
    lines.push([t.date, t.service, (t.kind === 'refunded' ? '-' : '') + money(t.cents), t.howPaid, t.status].map(csvCell).join(','));
  }
  lines.push('');
  lines.push(['', 'TOTAL COLLECTED + DUE', money(m.totalCents), '', ''].map(csvCell).join(','));
  return '﻿' + lines.join('\r\n');
}

// GET /api/cms/reports/export?siteId=&from=&to=&format=csv|pdf|docx
async function exportReport(req, res) {
  try {
    const siteId = req.query?.siteId;
    if (!siteId) return res.status(400).send('Missing siteId.');
    const site = await verifySiteOwnership(req.cmsUser.id, siteId);
    if (!site) return res.status(403).send('Not your site.');
    const { fromIso, toIso } = periodRange(req.query);
    const format = String(req.query?.format || 'csv').toLowerCase();

    const m = await buildModel(siteId, fromIso, toIso);
    m.generatedAt = req.query?.now ? String(req.query.now) : null; // client passes a display date (server has no Date in workflows, but this is a plain request)
    const base = `${m.subdomain}-revenue-${fromIso.slice(0, 10)}_to_${toIso.slice(0, 10)}`;

    if (format === 'pdf') {
      const buf = await renderReportPdf(m);
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Disposition', `attachment; filename="${base}.pdf"`);
      return res.send(buf);
    }
    if (format === 'docx') {
      const buf = await renderReportDocx(m);
      res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.set('Content-Disposition', `attachment; filename="${base}.docx"`);
      return res.send(buf);
    }
    // CSV (default)
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${base}.csv"`);
    return res.send(reportCsv(m));
  } catch (err) {
    console.error('[reports.export]', err.message);
    res.status(500).send('Could not export.');
  }
}

// buildModel is exported so the commission meter (lib/commissionMeter.js) computes
// booking + membership revenue from the EXACT same logic the owner Reports show.
module.exports = { getReport, exportReport, buildModel };
