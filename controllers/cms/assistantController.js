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
const nodemailer = require('nodemailer');
const { verifySiteOwnership } = require('../../middleware/cmsAuth');
const { buildSiteContext } = require('../../lib/stacyContext');
const { buildOnboardingChecklist, setOnboardingState } = require('../../lib/stacyOnboarding');
const { logSiteActivity } = require('../../lib/activity');

const STACY_N8N_URL = process.env.STACY_N8N_URL;          // public n8n Stacy webhook
const N8N_SECRET = process.env.N8N_WEBHOOK_SECRET;        // sent as x-leadgen-secret (server→n8n convention)
const STACY_MODEL = process.env.STACY_MODEL || 'gpt-4o';  // per-conversation default; provider-switchable in n8n

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

function createTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  });
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
  if (!to || !process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) return;
  const label = site.subdomain || site.id;
  createTransporter().sendMail({
    from: `"STEMfra Stacy" <${process.env.GMAIL_USER}>`,
    to,
    replyTo: ownerEmail || undefined,
    subject: `Stacy: ${label} asked to talk to a human`,
    text:
      `An owner using Stacy in the CMS asked to be connected to a person.\n\n` +
      `Site: ${label}\nOwner: ${ownerEmail || 'unknown'}\n\n` +
      `What they said:\n"${message}"\n\n` +
      `Stacy replied:\n"${reply}"\n\n` +
      `Follow up with them directly.`,
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
    const context = await buildSiteContext(siteId);
    const history = (conv.messages || []).slice(-12); // recent turns only

    let reply = '';
    let handoff = false;
    let toolLog = [];
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
    } catch (e) {
      console.error('[stacy.send] n8n error:', e.message);
      return res.status(502).json({ error: 'Stacy could not respond right now. Please try again.' });
    }

    const assistantMsg = { role: 'assistant', content: reply, ts: new Date().toISOString(), ...(handoff ? { handoff: true } : {}) };
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

    res.json({ reply, handoff, conversationId });
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
