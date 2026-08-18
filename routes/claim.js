// PUBLIC claim-funnel endpoints (launch funnel, 2026-08-19).
//   GET  /api/claim/:token              → the personalized offer for the Claim page
//   POST /api/claim/:token/event        → first-party funnel event (marketing_events)
//   GET  /api/claim/unsubscribe/:token  → one-click unsubscribe (do_not_email) + tiny page
// Tokens = leads.claim_token (random UUID, lib/claimTokens.js): no PII in URLs.
const express = require('express');
const supabase = require('../config/supabase');
const { leadForClaimToken } = require('../lib/claimTokens');
const { resolveClaimOffer } = require('../lib/claimOffer');
const router = express.Router();

const ALLOWED_EVENTS = new Set(['claim_page_view', 'claim_cta_click', 'claim_demo_click', 'claim_see_live_click', 'signup_start']);
const hits = new Map();
function limited(ip, max = 120) {
  const now = Date.now(); const arr = (hits.get(ip) || []).filter((t) => now - t < 60_000); arr.push(now); hits.set(ip, arr); return arr.length > max;
}
const ipOf = (req) => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || null;

const loadLead = (token) => leadForClaimToken(token);

router.get('/unsubscribe/:token', async (req, res) => {
  const lead = await loadLead(req.params.token);
  if (lead) {
    await supabase.from('leads').update({ do_not_email: true, outreach_status: 'unsubscribed' }).eq('id', lead.id).then(() => {}, () => {});
    await supabase.from('marketing_events').insert({ lead_id: lead.id, event: 'unsubscribe', ip: ipOf(req), user_agent: req.headers['user-agent'] || null }).then(() => {}, () => {});
  }
  res.set('Content-Type', 'text/html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribed | Stemfra</title></head><body style="margin:0;background:#f6f6f4;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#211c18;"><div style="max-width:520px;margin:12vh auto;padding:40px;background:#fff;text-align:center;"><div style="font-size:12px;letter-spacing:.3em;">STEMFRA</div><h1 style="font-weight:300;font-size:26px;margin:24px 0 12px;">You are unsubscribed</h1><p style="color:#5a5f5c;line-height:1.7;">We will not email you again. If this was a mistake, reply to any of our emails and we will put you back.</p><p style="margin-top:28px;"><a href="https://stemfra.com" style="color:#211c18;">stemfra.com</a></p></div></body></html>`);
});

router.get('/:token', async (req, res) => {
  if (limited(ipOf(req))) return res.status(429).json({ error: 'Too many requests' });
  const lead = await loadLead(req.params.token);
  if (!lead) return res.status(404).json({ error: 'not_found' });
  if (lead.do_not_email) return res.status(410).json({ error: 'gone' });
  try {
    const offer = await resolveClaimOffer(lead);
    res.set('Cache-Control', 'private, no-store');
    res.json({ ok: true, offer });
  } catch (err) {
    console.error('[claim] offer failed', err.message);
    res.status(500).json({ error: 'Could not load this offer.' });
  }
});

router.post('/:token/event', async (req, res) => {
  if (limited(ipOf(req), 60)) return res.status(429).json({ ok: false });
  const lead = await loadLead(req.params.token);
  if (!lead) return res.status(404).json({ ok: false });
  const { event, path = null, referrer = null, utm = null } = req.body || {};
  if (!ALLOWED_EVENTS.has(event)) return res.status(400).json({ ok: false, error: 'bad_event' });
  await supabase.from('marketing_events').insert({
    lead_id: lead.id, event, path: path ? String(path).slice(0, 300) : null, referrer: referrer ? String(referrer).slice(0, 300) : null,
    utm: utm && typeof utm === 'object' ? utm : {}, ip: ipOf(req), user_agent: (req.headers['user-agent'] || '').slice(0, 300),
  }).then(() => {}, (e) => console.error('[claim] event insert failed', e.message));
  // Engagement also flips the lead to warm so the sequencer/Mark see it.
  if (event === 'claim_cta_click' || event === 'signup_start') {
    await supabase.from('leads').update({ engagement_status: 'engaged', lead_temperature: 'warm' }).eq('id', lead.id).then(() => {}, () => {});
  }
  res.json({ ok: true });
});

module.exports = router;
