// Public setup-call booking endpoints (P12 §3) — called by the marketing site.
// No auth (public prospects); writes go through the service-role client in
// lib/setupCall. A small per-IP in-memory rate limit protects the booking POST.
const setupCall = require('../lib/setupCall');

const hits = new Map();
function rateLimited(ip, max = 8, windowMs = 60000) {
  const now = Date.now();
  const rec = hits.get(ip) || { n: 0, t: now };
  if (now - rec.t > windowMs) { rec.n = 0; rec.t = now; }
  rec.n += 1; hits.set(ip, rec);
  if (hits.size > 5000) hits.delete(hits.keys().next().value); // cap
  return rec.n > max;
}

// GET /api/setup-call/config — window + whether booking is live (for the UI).
async function config(_req, res) { res.json(await setupCall.publicConfig()); }

// GET /api/setup-call/month?year=&month= — dates with ≥1 open slot.
async function month(req, res) {
  try {
    const year = parseInt(req.query.year, 10);
    const m = parseInt(req.query.month, 10);
    if (!year || !m || m < 1 || m > 12) return res.status(400).json({ success: false, message: 'year and month (1-12) required' });
    res.json({ success: true, availableDates: await setupCall.getMonthDates(year, m) });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
}

// GET /api/setup-call/availability?date=YYYY-MM-DD — open 'HH:mm' slots (ET).
async function availability(req, res) {
  try {
    if (!req.query.date) return res.status(400).json({ success: false, message: 'date required' });
    res.json({ success: true, slots: await setupCall.getDaySlots(req.query.date) });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
}

// POST /api/setup-call/book — { name, email, phone?, businessName?, vertical?, notes?, date, time, leadId? }
async function book(req, res) {
  try {
    const ip = String(req.headers['x-forwarded-for'] || req.ip || 'unknown').split(',')[0].trim();
    if (rateLimited(ip)) return res.status(429).json({ success: false, message: 'Too many requests — please try again shortly.' });
    const b = req.body || {};
    const r = await setupCall.book({
      name: b.name, email: b.email, phone: b.phone, businessName: b.businessName,
      vertical: b.vertical, notes: b.notes, date: b.date, time: b.time, leadId: b.leadId,
    });
    if (!r.ok) return res.status(r.code || 500).json({ success: false, message: r.message });
    res.json({ success: true, meetLink: r.meetLink, startsAt: r.startsAt, timeZone: r.timeZone });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
}

module.exports = { config, month, availability, book };
