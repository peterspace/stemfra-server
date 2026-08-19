// Stacy (Agent 5) — CMS copilot. S1 = read & answer: the owner chats; the n8n
// "Stacy" workflow answers from their live site data (built here) + flags a
// human handoff. Conversations + messages persisted in agent_conversations
// (logged from S1, Decision 11). Owner-auth only (requireCmsAuth +
// verifySiteOwnership) — site_id comes from the session, no tenant resolution.
//
// S1 is synchronous (quick Q&A): server → n8n webhook → reply in the response.
// (Long multi-step work in S3 can move to the async init/poll/callback shape
// from the tkle blueprint.)
//
// Single-var supabase require per the server convention.
const supabase = require('../../config/supabase');
const emails = require('../../templates/transactionalEmails');
const { sendMail } = require('../../lib/mailer');
const { verifySiteOwnership } = require('../../middleware/cmsAuth');
const { buildSiteContext } = require('../../lib/stacyContext');
const { buildOnboardingChecklist, setOnboardingState } = require('../../lib/stacyOnboarding');
const { logSiteActivity } = require('../../lib/activity');
const { CMS_GUIDE } = require('../../lib/cmsRoutes');

const STACY_N8N_URL = process.env.STACY_N8N_URL;          // public n8n Stacy webhook
const N8N_SECRET = process.env.N8N_WEBHOOK_SECRET;        // sent as x-leadgen-secret (server→n8n convention)
const STACY_MODEL = process.env.STACY_MODEL || 'gpt-4o';  // per-conversation default; provider-switchable in n8n

// S3 (act) — whitelist the actions Stacy may PROPOSE. The server never executes;
// it relays a validated proposal to the CMS, which shows a confirm card and (on
// the owner's explicit OK) runs the real endpoint. Stacy stays "confirm-before-act".
// Actions: 'clone' (duplicate the current site) + 'update_contact' (patch the
// home Location section's address/phone/email — the do-it-for-me path for the
// onboarding contact step; the CMS card applies via the owner's own RLS write).
// Tappable "Open X →" chips (Peter, 2026-08-19): when Stacy tells the owner
// WHERE to go ("go to Hours & timezone", "Website → Pages → Home → Location")
// the CMS renders a link to that page. Matched against CMS_GUIDE `where`
// labels: the full path, or its last segment when it is specific enough (≥ 2
// words or a known single-word sidebar item). Longest match wins per route;
// order = order of appearance in the reply; max 4.
const GUIDE_SINGLE_OK = new Set(['services', 'team', 'bookings', 'inbox', 'clients', 'analytics', 'support']);
function guideLinksFor(reply) {
  const text = String(reply || '');
  if (!text) return [];
  const norm = (t) => t.replace(/\s*(→|->|>|›)\s*/g, ' → ').replace(/\s+/g, ' ').trim().toLowerCase();
  const hay = norm(text);
  const hits = [];
  for (const g of CMS_GUIDE) {
    const full = norm(g.where);
    const last = full.split(' → ').pop();
    let idx = hay.indexOf(full);
    let key = full;
    if (idx < 0 && (last.split(' ').length >= 2 || GUIDE_SINGLE_OK.has(last))) {
      const re = new RegExp(`(^|[^a-z])${last.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z])`);
      const m = re.exec(hay);
      if (m) { idx = m.index; key = last; }
    }
    if (idx >= 0) {
      // Chip label = the place + its parent when the leaf alone is vague
      // ("Home → Location", "Style → Themes"; top-level items stay bare).
      const segs = g.where.split(/\s*→\s*/);
      const label = segs.length >= 3 ? segs.slice(-2).join(' → ') : segs[segs.length - 1];
      hits.push({ idx, len: key.length, label, route: g.route });
    }
  }
  hits.sort((a, b) => a.idx - b.idx || b.len - a.len);
  const out = []; const seen = new Set();
  for (const h of hits) {
    if (seen.has(h.route)) continue;
    seen.add(h.route); out.push({ label: h.label, route: h.route });
    if (out.length >= 4) break;
  }
  return out;
}

function normalizeAction(a) {
  if (!a || typeof a !== 'object') return null;
  const s = (v, n) => (v && String(v).trim().slice(0, n)) || null;
  if (a.type === 'clone') {
    return {
      type: 'clone',
      businessName: s(a.businessName, 80),
      city: s(a.city, 60),
    };
  }
  if (a.type === 'update_contact') {
    const out = {
      type: 'update_contact',
      address: s(a.address, 160),
      phone: s(a.phone, 40),
      email: s(a.email, 120),
      locationName: s(a.locationName ?? a.location_name, 120),
    };
    // At least one real field, else drop the proposal.
    return out.address || out.phone || out.email || out.locationName ? out : null;
  }
  return null;
}

// Append messages to a conversation's jsonb array (single owner per chat → no race concern at S1).
async function appendMessages(id, msgs) {
  const { data } = await supabase.from('agent_conversations').select('messages').eq('id', id).single();
  const messages = [...(data?.messages || []), ...msgs];
  await supabase.from('agent_conversations').update({ messages }).eq('id', id);
}

async function appendToolLog(id, entries) {
  if (!entries?.length) return;
  const { data } = await supabase.from('agent_conversations').select('tool_log').eq('id', id).single();
  await supabase.from('agent_conversations').update({ tool_log: [...(data?.tool_log || []), ...entries] }).eq('id', id);
}

// Real handoff: when Stacy flags a human is wanted, write a site_activity audit
// row (await — one fast insert) + fire a best-effort staff email (NOT awaited, so
// it never delays the chat reply; email failure is logged, never thrown). This is
// what turns "talk to a human" from a UI note into an actual alert that reaches us.
async function notifyHandoff({ site, ownerEmail, message, reply }) {
  await logSiteActivity({
    siteId: site.id,
    actorName: ownerEmail || 'Site owner',
    action: 'stacy_handoff_requested',
    entityType: 'site',
    entityId: site.id,
    details: { message, reply_preview: (reply || '').slice(0, 240) },
  });

  const to = process.env.NOTIFY_EMAIL || process.env.GMAIL_USER;
  if (!to) return;
  const label = site.subdomain || site.id;
  sendMail({
    fromName: 'STEMfra Stacy',
    to,
    replyTo: ownerEmail || undefined,
    subject: `Stacy: ${label} asked to talk to a human`,
    text:
      `An owner using Stacy in the CMS asked to be connected to a person.\n\n` +
      `Site: ${label}\nOwner: ${ownerEmail || 'unknown'}\n\n` +
      `What they said:\n"${message}"\n\n` +
      `Stacy replied:\n"${reply}"\n\n` +
      `Follow up with them directly.`,
    html: emails.staffHandoffNotification({ siteLabel: label, ownerEmail, message, reply }),
  }).catch(err => console.error('[stacy.handoff] email failed:', err.message));
}

// POST /api/cms/assistant/init  { siteId, conversationId? }
async function init(req, res) {
  try {
    const { siteId, conversationId } = req.body || {};
    const site = await verifySiteOwnership(req.cmsUser.id, siteId);
    if (!site) return res.status(403).json({ error: 'You do not have access to this site.' });

    if (conversationId) {
      const { data: existing } = await supabase
        .from('agent_conversations').select('id, messages, model')
        .eq('id', conversationId).eq('site_id', siteId).maybeSingle();
      if (existing) return res.json({ conversationId: existing.id, messages: existing.messages || [], model: existing.model, isExisting: true });
    }

    const { data, error } = await supabase.from('agent_conversations')
      .insert({ site_id: siteId, created_by: req.cmsUser.id, agent: 'stacy', model: STACY_MODEL, title: 'New chat' })
      .select('id, messages, model').single();
    if (error) throw new Error(error.message);
    res.json({ conversationId: data.id, messages: data.messages || [], model: data.model, isExisting: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/cms/assistant/send  { siteId, conversationId, message }
async function send(req, res) {
  try {
    const { siteId, conversationId, message } = req.body || {};
    if (!message || !String(message).trim()) return res.status(400).json({ error: 'message is required.' });

    const site = await verifySiteOwnership(req.cmsUser.id, siteId);
    if (!site) return res.status(403).json({ error: 'You do not have access to this site.' });

    const { data: conv } = await supabase.from('agent_conversations')
      .select('id, messages, model').eq('id', conversationId).eq('site_id', siteId).maybeSingle();
    if (!conv) return res.status(404).json({ error: 'Conversation not found.' });

    if (!STACY_N8N_URL) return res.status(503).json({ error: 'Stacy is not configured on the server yet.' });

    const userMsg = { role: 'user', content: String(message).trim(), ts: new Date().toISOString() };
    // Stacy gets the CMS map (where to change what); the public Front Desk does not.
    const context = await buildSiteContext(siteId, { includeCmsMap: true });
    const history = (conv.messages || []).slice(-12); // recent turns only

    let reply = '';
    let handoff = false;
    let toolLog = [];
    let action = null;
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (N8N_SECRET) headers['x-leadgen-secret'] = N8N_SECRET;
      const r = await fetch(STACY_N8N_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({ conversationId, siteId, agent: 'stacy', model: conv.model || STACY_MODEL, message: userMsg.content, history, context }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `Stacy workflow error (${r.status})`);
      reply = data.reply ?? data.output ?? '';
      handoff = !!data.handoff;
      toolLog = Array.isArray(data.tool_log) ? data.tool_log : [];
      action = normalizeAction(data.action);
    } catch (e) {
      console.error('[stacy.send] n8n error:', e.message);
      return res.status(502).json({ error: 'Stacy could not respond right now. Please try again.' });
    }

    const links = guideLinksFor(reply);
    // "Where do I…?" answers (Peter, 2026-08-19): no step-by-step path prose
    // in the CMS; one short line + the Open chips, which navigate directly.
    if (links.length && /\b(where|how (do|can|would) i|how to|where's|wheres)\b/i.test(userMsg.content || '')) {
      reply = links.length > 1 ? 'Here is where those live. Tap one to open it:' : 'Here is where that lives. Tap to open it:';
    }
    const assistantMsg = { role: 'assistant', content: reply, ts: new Date().toISOString(), ...(handoff ? { handoff: true } : {}), ...(links.length ? { links } : {}) };
    await appendMessages(conversationId, [userMsg, assistantMsg]);
    await appendToolLog(conversationId, toolLog);

    // Title the conversation from its first user message (so the History tab is
    // readable instead of a list of "New chat").
    if (!(conv.messages && conv.messages.length)) {
      const title = userMsg.content.length > 60 ? `${userMsg.content.slice(0, 57)}…` : userMsg.content;
      await supabase.from('agent_conversations').update({ title }).eq('id', conversationId);
    }

    // Real handoff: audit + best-effort staff email. Best-effort overall — a
    // notification failure must not fail the chat turn the owner just had.
    if (handoff) {
      try {
        await notifyHandoff({ site, ownerEmail: req.cmsUser.email, message: userMsg.content, reply });
      } catch (e) {
        console.error('[stacy.send] handoff notify failed:', e.message);
      }
    }

    res.json({ reply, handoff, action, conversationId, links: assistantMsg.links || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// GET /api/cms/assistant?siteId=  — conversation list (newest first)
async function list(req, res) {
  try {
    const siteId = req.query.siteId;
    const site = await verifySiteOwnership(req.cmsUser.id, siteId);
    if (!site) return res.status(403).json({ error: 'You do not have access to this site.' });
    const { data } = await supabase.from('agent_conversations')
      .select('id, title, status, updated_at')
      .eq('site_id', siteId).eq('agent', 'stacy').eq('status', 'open')
      .order('updated_at', { ascending: false }).limit(30);
    res.json({ conversations: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// GET /api/cms/assistant/:id?siteId=  — one conversation + messages
async function get(req, res) {
  try {
    const siteId = req.query.siteId;
    const site = await verifySiteOwnership(req.cmsUser.id, siteId);
    if (!site) return res.status(403).json({ error: 'You do not have access to this site.' });
    const { data } = await supabase.from('agent_conversations')
      .select('id, title, messages, model, status').eq('id', req.params.id).eq('site_id', siteId).maybeSingle();
    if (!data) return res.status(404).json({ error: 'Conversation not found.' });
    res.json({ conversation: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// PATCH /api/cms/assistant/:id  { siteId, title }  — rename a conversation
async function rename(req, res) {
  try {
    const { siteId, title } = req.body || {};
    if (!title || !String(title).trim()) return res.status(400).json({ error: 'Title is required.' });
    const site = await verifySiteOwnership(req.cmsUser.id, siteId);
    if (!site) return res.status(403).json({ error: 'You do not have access to this site.' });
    const { data, error } = await supabase.from('agent_conversations')
      .update({ title: String(title).trim().slice(0, 80) })
      .eq('id', req.params.id).eq('site_id', siteId)
      .select('id, title').maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return res.status(404).json({ error: 'Conversation not found.' });
    res.json({ conversation: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// GET /api/cms/assistant/onboarding?siteId=  — the setup checklist for this site
async function onboarding(req, res) {
  try {
    const siteId = req.query.siteId;
    const site = await verifySiteOwnership(req.cmsUser.id, siteId);
    if (!site) return res.status(403).json({ error: 'You do not have access to this site.' });
    res.json(await buildOnboardingChecklist(siteId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/cms/assistant/onboarding  { siteId, key?, done?, dismissed? }  — mark a step / dismiss
async function onboardingMark(req, res) {
  try {
    const { siteId, key, done, dismissed } = req.body || {};
    const site = await verifySiteOwnership(req.cmsUser.id, siteId);
    if (!site) return res.status(403).json({ error: 'You do not have access to this site.' });
    await setOnboardingState(siteId, { key, done, dismissed });
    res.json(await buildOnboardingChecklist(siteId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { init, send, list, get, rename, onboarding, onboardingMark };
