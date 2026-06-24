// Concierge (Agent 1) — the chat on Stemfra's OWN marketing site. PUBLIC, single
// "tenant" (Stemfra itself), so unlike Front Desk there's no siteId and we keep it
// STATELESS server-side: the widget holds the conversation and sends recent `history`
// each turn (a marketing chat doesn't need DB-persisted threads, and it avoids the
// NOT NULL agent_conversations.site_id). Answers from Stemfra product knowledge,
// guides visitors to self-serve onboarding, and captures a lead to the CRM `leads`
// table when a human follow-up is wanted.
const supabase = require('../config/supabase');
const { DateTime } = require('luxon');
const { buildConciergeContext } = require('../lib/conciergeContext');

let fireSpeedToLead = null;
try { ({ fireSpeedToLead } = require('../routes/speedToLead')); } catch { /* optional */ }

const CONCIERGE_N8N_URL = process.env.CONCIERGE_N8N_URL;
const N8N_SECRET = process.env.N8N_WEBHOOK_SECRET;
const CONCIERGE_MODEL = process.env.CONCIERGE_MODEL || 'gpt-4o';
const EMAIL_RE = /^\S+@\S+\.\S+$/;

// CTA buttons the agent may surface (keys → server-controlled label + internal path,
// so the model can't inject arbitrary URLs).
const CTA_LINKS = buildConciergeContext().links;
const CTA_LABELS = { start_free: 'Start free', pricing: 'See pricing', examples: 'See examples', contact: 'Talk to us' };

// Per-IP in-memory rate limit (public endpoint + LLM cost protection; per-instance).
const hits = new Map();
function rateLimited(key, limit = 20, windowMs = 60_000) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter(t => now - t < windowMs);
  arr.push(now);
  hits.set(key, arr);
  return arr.length > limit;
}

// Write a marketing lead to the CRM `leads` table + kick off speed-to-lead.
async function captureLead(lead) {
  const email = typeof lead.email === 'string' && EMAIL_RE.test(lead.email.trim()) ? lead.email.trim().toLowerCase() : null;
  const name = typeof lead.name === 'string' && lead.name.trim() ? lead.name.trim() : null;
  if (!name && !email) return; // need at least a name or an email to be useful

  const notes = [
    lead.summary && String(lead.summary).trim(),
    lead.vertical ? `Business type: ${lead.vertical}` : '',
    lead.wants_call ? 'Requested a call / human follow-up.' : '',
    '— Captured by the website Concierge chat.',
  ].filter(Boolean).join('\n');

  const { data: row, error } = await supabase.from('leads').insert([{
    contact_name: name || email,
    company_name: typeof lead.company === 'string' && lead.company.trim() ? lead.company.trim() : null,
    email,
    service: 'website',          // inbound website-product inquiry (free text on `leads`)
    stage: 'new_lead',
    source: 'website_chat',
    lead_source: 'website_chat',
    notes,
    last_activity_at: new Date().toISOString(),
  }]).select('id').single();
  if (error) { console.error('[concierge] lead insert failed:', error.message); return; }

  if (fireSpeedToLead) {
    fireSpeedToLead(row.id, { source: 'website_chat' })
      .then(r => { if (r && !r.ok) console.warn('[concierge] speed-to-lead not started:', r.reason); })
      .catch(e => console.error('[concierge] speed-to-lead error:', e.message));
  }
}

// POST /api/concierge/send  { message, history?: [{role, content}] }
async function send(req, res) {
  try {
    const { message, history } = req.body || {};
    if (!message || !String(message).trim()) return res.status(400).json({ error: 'message is required.' });

    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
    if (rateLimited(ip)) return res.status(429).json({ error: 'Too many messages — please slow down a moment.' });

    if (!CONCIERGE_N8N_URL) return res.status(503).json({ error: 'The assistant is not configured yet.' });

    const context = buildConciergeContext();
    const today = DateTime.now().setZone('America/New_York').toFormat("yyyy-MM-dd '('cccc')'");
    const hist = Array.isArray(history)
      ? history.slice(-12).filter(m => m && typeof m.role === 'string' && typeof m.content === 'string')
      : [];

    let reply = '', lead = null, quickReplies = [], ctaKeys = [];
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (N8N_SECRET) headers['x-leadgen-secret'] = N8N_SECRET;
      const r = await fetch(CONCIERGE_N8N_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({ agent: 'concierge', model: CONCIERGE_MODEL, message: String(message).trim(), history: hist, context, today }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `Concierge workflow error (${r.status})`);
      reply = data.reply ?? data.output ?? '';
      if (data.lead && typeof data.lead === 'object') lead = data.lead;
      if (Array.isArray(data.quick_replies)) quickReplies = data.quick_replies.filter(s => typeof s === 'string' && s.trim()).slice(0, 6);
      if (Array.isArray(data.cta)) ctaKeys = data.cta.filter(k => CTA_LINKS[k]);
    } catch (e) {
      console.error('[concierge.send] n8n error:', e.message);
      return res.status(502).json({ error: 'The assistant could not respond right now. Please try again.' });
    }

    if (lead) captureLead(lead).catch(e => console.error('[concierge] captureLead error:', e.message));

    // Build a CTA card from the agent's requested link keys (server-controlled hrefs).
    let card = null;
    if (ctaKeys.length) {
      card = { kind: 'cta', actions: ctaKeys.map(k => ({ label: CTA_LABELS[k], href: CTA_LINKS[k] })) };
      quickReplies = []; // a CTA card supersedes chips
    }

    res.json({ reply, quick_replies: quickReplies, card });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { send };
