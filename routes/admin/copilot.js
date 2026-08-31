// copilot.js — the stemfra CRM side Copilot (P23 item 2; the Helen
// Lead-Gen copilot ported): answers from a live business snapshot + an
// app guide, proposes whitelisted actions the user confirms with a
// click, persisted per-staff conversations with rename/delete/rewind.
// OpenAI direct per the back-office drafting standard.
const express = require('express');
const OpenAI = require('openai');
const supabase = require('../../config/supabase');
const { requireStaffAuth } = require('../../middleware/staffAuth');
const { buildCrmCopilotContext } = require('../../lib/crmCopilotContext');

const router = express.Router();
const MODEL = process.env.COPILOT_MODEL || process.env.LEADGEN_MODEL || 'gpt-4o';
const client = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const MAX_STORED = 60;

async function loadConvo(userId, id) {
  const { data } = await supabase.from('crm_copilot_conversations')
    .select('id, title, messages').eq('created_by', userId).eq('id', id).maybeSingle();
  return data;
}

async function saveConvo(id, messages, patch = {}) {
  await supabase.from('crm_copilot_conversations').update({
    messages: messages.slice(-MAX_STORED),
    updated_at: new Date().toISOString(),
    ...patch,
  }).eq('id', id);
}

// Link chips: a surface named AS A PLACE in the reply becomes a tappable
// row (the guarded-match lesson from the leadgen copilot).
const SURFACES = [
  { label: 'Dashboard', route: '/dashboard' },
  { label: 'Lead Pipeline', route: '/leads' },
  { label: 'Inbox', route: '/inbox' },
  { label: 'CRM', route: '/crm' },
  { label: 'Customer Sites', route: '/sites' },
  { label: 'Stemfra Billing', route: '/billing' },
  { label: 'Expense Receipts', route: '/expense-receipts' },
  { label: 'Compliance', route: '/compliance' },
  { label: 'Client Bookings', route: '/client-bookings' },
  { label: 'Settings', route: '/settings' },
];
function guideLinksFor(reply) {
  const hay = String(reply || '').toLowerCase();
  const hits = [];
  for (const s of SURFACES) {
    const esc = s.label.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(\\*\\*\\s*|(?:go to|head to|open|visit|under|navigate to|found in|in the|page called|section called)\\s+(?:the\\s+)?)${esc}($|[^a-z])`);
    const m = re.exec(hay);
    if (m) hits.push({ idx: m.index, label: s.label, route: s.route });
  }
  hits.sort((a, b) => a.idx - b.idx);
  return hits.slice(0, 3).map(({ label, route }) => ({ label, route }));
}

// Whitelisted proposable actions (never executed here — the client shows
// a confirm card and runs the real endpoint on click).
const STAGES = ['new_lead', 'contacted', 'discovery_call', 'proposal_sent', 'negotiation', 'won', 'lost'];
function normalizeAction(a) {
  if (!a || typeof a !== 'object') return null;
  const s = (v, n) => (v && String(v).trim().slice(0, n)) || null;
  const ALIAS = { stage: 'set_stage', email: 'email_lead', draft_email: 'email_lead', scan: 'scan_expenses' };
  if (ALIAS[a.type]) a = { ...a, type: ALIAS[a.type] };
  if (a.type === 'set_stage') {
    const company = s(a.company, 120);
    const stage = STAGES.includes(a.stage) ? a.stage : null;
    return company && stage ? { type: 'set_stage', company, stage } : null;
  }
  if (a.type === 'email_lead') {
    const company = s(a.company, 120);
    return company ? { type: 'email_lead', company } : null;
  }
  if (a.type === 'scan_expenses') return { type: 'scan_expenses' };
  return null;
}

function extractAction(text) {
  const t = String(text || '');
  const idx = t.indexOf('ACTION:');
  if (idx < 0) return { reply: t, action: null };
  let action = null;
  for (const m of t.matchAll(/ACTION:[^{]*(\{[^{}]*\})/g)) {
    try { action = normalizeAction(JSON.parse(m[1])); } catch { /* malformed */ }
    if (action) break;
  }
  const reply = t.slice(0, idx).replace(/```(?:json)?\s*$/, '').trim();
  return { reply, action };
}

// Where things live in THIS app — keep in step with the Sidebar.
const APP_GUIDE = `
The CRM's surfaces (left sidebar):
- Dashboard: today's overview — pipeline, revenue, follow-ups, recent leads.
- Lead Pipeline: the sales pipeline. Pipeline tab = Kanban by stage; Table tab = the sortable list (stat cards jump into it pre-filtered); clicking a row opens the quick-facts drawer with the cold-call script beside the business facts.
- Setup Calls / Email Templates: booked marketing setup calls; the outreach templates.
- CRM: contacts and companies; per-contact Send email opens the Gmail composer (fonts, AI draft + refine chips, your signature auto-appended).
- Inbox: your own Gmail inside the CRM — read threads, reply with the AI-assisted composer. Needs the Google sign-in.
- Sales Tracker / Custom Pricing: sales records; custom website-build quotes.
- Customer Sites: every tenant site — provision, clone, publish, domains.
- Domains / Site Monitor / Support / Templates: platform operations.
- Stemfra Billing: client invoices and subscriptions, the reconciliation tab.
- Compliance: tax registry, rates, books, filing calendar.
- Client Bookings / Client Payments: cross-tenant booking and membership oversight.
- Expense Receipts (Finance): auto-harvested expense receipts from the linked mailboxes, exclude toggle, renewals-due table, Export, Add expense for dashboard-only invoices.
- Settings: profile (incl. your email signature), calls, integrations.`;

// ── Conversation CRUD ───────────────────────────────────────────────────────
router.get('/conversations', requireStaffAuth, async (req, res) => {
  const { data, error } = await supabase.from('crm_copilot_conversations')
    .select('id, title, updated_at').eq('created_by', req.staffUser.id)
    .order('updated_at', { ascending: false }).limit(30);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ conversations: data });
});

router.get('/conversations/:id', requireStaffAuth, async (req, res) => {
  const convo = await loadConvo(req.staffUser.id, req.params.id);
  if (!convo) return res.status(404).json({ error: 'Conversation not found' });
  res.json(convo);
});

router.patch('/conversations/:id', requireStaffAuth, async (req, res) => {
  const title = String(req.body?.title || '').trim().slice(0, 80);
  if (!title) return res.status(400).json({ error: 'title required' });
  const { error } = await supabase.from('crm_copilot_conversations')
    .update({ title }).eq('created_by', req.staffUser.id).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

router.delete('/conversations/:id', requireStaffAuth, async (req, res) => {
  const { error } = await supabase.from('crm_copilot_conversations')
    .delete().eq('created_by', req.staffUser.id).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// "Rewind to here": truncate the persisted transcript so the copilot
// genuinely forgets the discarded turns.
router.post('/rewind', requireStaffAuth, async (req, res) => {
  const { conversation_id, keep } = req.body || {};
  const n = Number(keep);
  if (!conversation_id || !Number.isInteger(n) || n < 0) {
    return res.status(400).json({ error: 'conversation_id and keep are required.' });
  }
  const convo = await loadConvo(req.staffUser.id, conversation_id);
  if (!convo) return res.status(404).json({ error: 'Conversation not found' });
  await saveConvo(conversation_id, (convo.messages || []).slice(0, n));
  res.json({ kept: Math.min(n, (convo.messages || []).length) });
});

// Honest post-action note ("Done, stage set…") appended by the client.
router.post('/note', requireStaffAuth, async (req, res) => {
  const { conversation_id } = req.body || {};
  const content = String(req.body?.content || '').trim().slice(0, 500);
  if (!conversation_id || !content) return res.status(400).json({ error: 'conversation_id and content required' });
  const convo = await loadConvo(req.staffUser.id, conversation_id);
  if (!convo) return res.status(404).json({ error: 'Conversation not found' });
  await saveConvo(conversation_id, [...(convo.messages || []), { role: 'assistant', content, meta: true, at: new Date().toISOString() }]);
  res.json({ ok: true });
});

router.post('/send', requireStaffAuth, async (req, res) => {
  const message = String(req.body?.message || '').trim().slice(0, 2000);
  if (!message) return res.status(400).json({ error: 'message required' });

  let convo = req.body?.conversation_id ? await loadConvo(req.staffUser.id, req.body.conversation_id) : null;
  if (!convo) {
    const { data, error } = await supabase.from('crm_copilot_conversations')
      .insert({ created_by: req.staffUser.id }).select('id, title, messages').single();
    if (error) return res.status(500).json({ error: error.message });
    convo = data;
  }
  const history = convo.messages || [];
  const titlePatch = history.some((m) => m.role === 'user')
    ? {}
    : { title: message.length > 60 ? `${message.slice(0, 57)}…` : message };
  const userMsg = { role: 'user', content: message, at: new Date().toISOString() };

  if (!client) {
    const reply = { role: 'assistant', content: 'The copilot needs an OpenAI key (OPENAI_API_KEY) on the server. Everything else in the CRM works without it.', at: new Date().toISOString() };
    await saveConvo(convo.id, [...history, userMsg, reply], titlePatch);
    return res.json({ conversation_id: convo.id, reply: reply.content, model: 'template' });
  }

  try {
    const ctx = await buildCrmCopilotContext();
    const r = await client.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: 'system',
          content: `You are the copilot inside Stemfra's internal CRM. Stemfra builds and runs websites (with booking, payments, AI front desk) for US local businesses: barbershops, salons, fitness studios, wellness. The CRM manages BOTH the sales pipeline (prospecting local businesses) and the live client platform (tenant sites, billing, bookings). Answer questions using ONLY the live snapshot below; when asked where to do something, point at the exact surface using the app guide. Be concise (a few sentences; short markdown lists when they help). Numbers must come from the snapshot; if it does not hold the answer, say what to check and where. Never use em-dashes; use commas, colons, or periods. No hype, no invented data.

You can PROPOSE (never perform) these actions; the user confirms with a click:
- set_stage {"company": "<company name from the snapshot>", "stage": "new_lead|contacted|discovery_call|proposal_sent|negotiation|won|lost"}
- email_lead {"company": "<company name>"} (opens the email composer for that lead's contact, prefilled recipient; nothing sends until they click Send)
- scan_expenses {} (re-scan the linked mailboxes for new expense receipts now)
ONLY when the user explicitly asks for one of these: say in one sentence what you are proposing, then append as the very last line exactly ACTION:{"type":...} with the fields above. Never propose an action the user did not ask for; never output more than one.

${APP_GUIDE}

Live snapshot:
${JSON.stringify(ctx)}`,
        },
        ...history.filter((m) => !m.meta).slice(-12).map(({ role, content }) => ({ role, content })),
        { role: 'user', content: message },
      ],
      max_tokens: 500,
    });
    const raw = r.choices[0].message.content.trim();
    const { reply: content, action } = extractAction(raw);
    const links = guideLinksFor(content);
    const reply = {
      role: 'assistant', content, at: new Date().toISOString(),
      ...(links.length ? { links } : {}),
      ...(action ? { action } : {}),
    };
    await saveConvo(convo.id, [...history, userMsg, reply], titlePatch);
    res.json({ conversation_id: convo.id, reply: content, links, action, model: MODEL });
  } catch (e) {
    console.error('[crm-copilot] failed:', e.message);
    res.status(500).json({ error: `Copilot failed: ${e.message}` });
  }
});

module.exports = router;
