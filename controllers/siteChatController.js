// Front Desk (Agent 2), F1 = answer. The customer-facing chat widget on a
// client's template site. PUBLIC (no owner auth) — the tenant is the siteId the
// widget passes. Reuses Stacy's F1 context-builder (lib/stacyContext.js) and the
// same server→n8n proxy + x-leadgen-secret trust. Anonymous visitors: conversations
// are stored in agent_conversations with agent='frontdesk', created_by=null; the
// widget holds the conversationId as the session key.
//
// Single-var supabase require per the server convention.
const supabase = require('../config/supabase');
const { sendMail } = require('../lib/mailer');
const { cmsMagicLink } = require('../lib/cmsMagicLink');
const { getSiteNotifyPrefs } = require('../lib/notifyPrefs');
const emails = require('../templates/transactionalEmails');
const { DateTime } = require('luxon');
const { buildSiteContext } = require('../lib/stacyContext');
const { buildListCard } = require('../lib/frontdeskLists');
const { runBookingTool } = require('../lib/frontdeskBooking');
const { placeBooking, bookClassSession } = require('../controllers/bookingController');

const ALLOWED_CHAT = ['live', 'previewing'];

const FRONTDESK_N8N_URL = process.env.FRONTDESK_N8N_URL;
const N8N_SECRET = process.env.N8N_WEBHOOK_SECRET;
const FRONTDESK_MODEL = process.env.FRONTDESK_MODEL || 'gpt-4o';

// Lightweight in-memory rate limiter (per IP+site) — protects the PUBLIC endpoint
// and the LLM cost from abuse. Per-instance; fine for a single VPS container.
const hits = new Map();
function rateLimited(key, limit = 20, windowMs = 60_000) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter(t => now - t < windowMs);
  arr.push(now);
  hits.set(key, arr);
  return arr.length > limit;
}

async function appendMessages(id, msgs) {
  const { data } = await supabase.from('agent_conversations').select('messages').eq('id', id).single();
  const messages = [...(data?.messages || []), ...msgs];
  await supabase.from('agent_conversations').update({ messages }).eq('id', id);
}

const EMAIL_RE = /^\S+@\S+\.\S+$/;

// Merge the agent's freshly-emitted booking over the in-progress one. New non-empty
// values win; gathered fields are retained when the model drops them. `confirm` is
// taken fresh each turn (never retained) so a stale yes can't re-trigger a booking.
function mergeBooking(prev, next) {
  if (!next) return prev || null;
  const p = prev || {}, pc = p.customer || {}, nc = next.customer || {};
  return {
    intent: next.intent || p.intent || 'book',
    service: next.service || p.service || null,
    barber: next.barber || p.barber || null,
    date: next.date || p.date || null,
    time: next.time || p.time || null,
    notes: next.notes || p.notes || null,
    customer: { name: nc.name || pc.name || null, email: nc.email || pc.email || null, phone: nc.phone || pc.phone || null },
    confirm: next.confirm === true,
  };
}

// F2 — capture a lead from the chat. The Front Desk agent returns an optional
// `lead` object once a visitor leaves their details (name + email or phone) and
// wants follow-up/booking/a human. We write it to site_leads so it shows up in
// the CMS Leads inbox exactly like a contact-form enquiry. Idempotent per
// conversation: a second `lead` in the same chat UPDATES the existing row (the
// visitor may correct/add details across turns) rather than creating duplicates.
async function captureLead(site, convId, lead) {
  const email = typeof lead.email === 'string' && EMAIL_RE.test(lead.email.trim()) ? lead.email.trim().toLowerCase() : null;
  const phone = typeof lead.phone === 'string' && lead.phone.trim() ? lead.phone.trim() : null;
  if (!email && !phone) return; // need at least one way to reach them

  const name = typeof lead.name === 'string' && lead.name.trim() ? lead.name.trim() : null;
  const intent = typeof lead.intent === 'string' && lead.intent.trim() ? lead.intent.trim().slice(0, 120) : 'Website chat enquiry';
  const summary = typeof lead.summary === 'string' && lead.summary.trim() ? lead.summary.trim() : intent;
  const message = `${summary}\n\n— Captured by the website chat assistant.`;

  // Dedup by conversation: one lead row per chat, refreshed as details firm up.
  const { data: existing } = await supabase
    .from('site_leads')
    .select('id')
    .eq('site_id', site.id)
    .eq('metadata->>conversation_id', convId)
    .maybeSingle();

  const row = {
    name, email, phone,
    subject: intent,
    message,
    source_page: 'Chat assistant',
    metadata: { source: 'website_chat', conversation_id: convId, captured_by: 'frontdesk', intent },
  };

  if (existing) {
    await supabase.from('site_leads').update(row).eq('id', existing.id);
    return; // already notified when first created
  }

  const { error } = await supabase.from('site_leads').insert([{ site_id: site.id, status: 'new', ...row }]);
  if (error) { console.error('[site-chat] lead insert failed:', error.message); return; }

  // Notify the owner — best-effort, only for LIVE sites (don't email during preview/testing).
  if (site.status === 'live') notifyOwnerOfLead(site, { name, email, phone, intent, summary }).catch(e =>
    console.error('[site-chat] lead notify failed:', e.message));
}

// Identify a signed-in member from the magic-link session the member portal
// already issues. The widget sends its access token; we verify it server-side
// (never trust a client-supplied email) and match the verified address to this
// site's own customer row. Anonymous visitors simply resolve to null.
async function resolveMember(siteId, token) {
  if (!token || typeof token !== 'string') return null;
  try {
    const { data, error } = await supabase.auth.getUser(token);
    const user = data?.user;
    if (error || !user?.email) return null;
    const email = user.email.toLowerCase();
    const { data: cust } = await supabase
      .from('site_customers')
      .select('id, first_name, last_name, email, phone, auth_user_id, metadata')
      .eq('site_id', siteId)
      .or(`auth_user_id.eq.${user.id},email.eq.${email}`)
      .maybeSingle();
    const name = cust ? [cust.first_name, cust.last_name].filter(Boolean).join(' ').trim() : '';
    return {
      customerId: cust?.id || null,
      name: name || null,
      email: cust?.email || email,
      phone: cust?.phone || null,
      suspended: cust?.metadata?.suspended === true,
    };
  } catch { return null; }
}

const ESCALATION_LABELS = {
  refund: 'Refund request',
  complaint: 'Complaint',
  billing: 'Billing question',
  other: 'Needs a human',
};

// Escalation — anything the assistant must NOT answer itself (refunds, complaints,
// billing disputes). Deliberately lands in the SAME site_leads inbox the owner
// already works, rather than a parallel store they'd have to learn: it inherits the
// existing owner email + the lead_created bell notification for free. What marks it
// apart is `source_page` (so it's visible at a glance in the inbox) and
// metadata.kind='escalation' for anything that wants to filter later.
async function captureEscalation(site, convId, esc, member) {
  const reason = ESCALATION_LABELS[esc.reason] ? esc.reason : 'other';
  const label = ESCALATION_LABELS[reason];

  // A signed-in member never has to re-type what we already hold.
  const email = member?.email
    || (typeof esc.email === 'string' && EMAIL_RE.test(esc.email.trim()) ? esc.email.trim().toLowerCase() : null);
  const phone = member?.phone
    || (typeof esc.phone === 'string' && esc.phone.trim() ? esc.phone.trim() : null);
  const name = member?.name
    || (typeof esc.name === 'string' && esc.name.trim() ? esc.name.trim() : null);
  if (!email && !phone) return; // nothing to reply to — the agent keeps asking

  const summary = typeof esc.summary === 'string' && esc.summary.trim()
    ? esc.summary.trim().slice(0, 2000) : label;
  const who = member ? 'a signed-in member' : 'a website visitor';
  const message = `${summary}\n\n— Raised in the website chat by ${who}. The assistant did not answer it; it needs a reply from the business.`;

  const { data: existing } = await supabase
    .from('site_leads').select('id')
    .eq('site_id', site.id).eq('metadata->>conversation_id', convId).maybeSingle();

  const row = {
    name, email, phone,
    subject: label,
    message,
    source_page: `Chat escalation · ${label}`,
    metadata: {
      source: 'website_chat', conversation_id: convId, captured_by: 'frontdesk',
      kind: 'escalation', reason, urgent: true,
      member_customer_id: member?.customerId || null,
    },
  };

  if (existing) { await supabase.from('site_leads').update(row).eq('id', existing.id); return; }
  const { error } = await supabase.from('site_leads').insert([{ site_id: site.id, status: 'new', ...row }]);
  if (error) { console.error('[site-chat] escalation insert failed:', error.message); return; }

  if (site.status === 'live') notifyOwnerOfEscalation(site, { label, name, email, phone, summary, member: !!member })
    .catch(e => console.error('[site-chat] escalation notify failed:', e.message));
}

// Escalations reuse the chat-lead notification preference and template: an owner
// who wants chat leads emailed certainly wants a refund request emailed. Only the
// wording changes, so no new template or preference key is introduced.
async function notifyOwnerOfEscalation(site, esc) {
  if (!site.owner_contact_id) return;
  const prefs = await getSiteNotifyPrefs(site.id);
  if (!prefs.owner_chat_lead) return;
  const { data: owner } = await supabase.from('contacts').select('email, full_name, auth_user_id').eq('id', site.owner_contact_id).single();
  if (!owner?.email) return;
  const dashboardUrl = await cmsMagicLink(owner.auth_user_id, '/leads');
  const intent = `${esc.label}${esc.member ? ' (signed-in member)' : ''}`;
  await sendMail({
    fromName: 'STEMfra Sites',
    to: owner.email,
    subject: `Action needed: ${esc.label} from your website chat`,
    text: [
      `Someone raised something on your website that the chat assistant did not answer.`,
      `It is waiting for a reply from you.`,
      ``,
      `Type: ${esc.label}`,
      `From: ${esc.member ? 'a signed-in member' : 'a website visitor'}`,
      `Name: ${esc.name || '(not given)'}`,
      `Email: ${esc.email || '(not given)'}`,
      `Phone: ${esc.phone || '(not given)'}`,
      ``,
      `What they said:`,
      esc.summary,
      ``,
      `It is in your dashboard under Leads.`,
    ].join('\n'),
    html: emails.ownerChatLeadNotification({
      name: esc.name, email: esc.email, phone: esc.phone,
      intent, summary: esc.summary, dashboardUrl,
    }),
  });
}

async function notifyOwnerOfLead(site, lead) {
  if (!site.owner_contact_id) return;
  const prefs = await getSiteNotifyPrefs(site.id);
  if (!prefs.owner_chat_lead) return;
  const { data: owner } = await supabase.from('contacts').select('email, full_name, auth_user_id').eq('id', site.owner_contact_id).single();
  if (!owner?.email) return;
  const dashboardUrl = await cmsMagicLink(owner.auth_user_id, '/leads');
  await sendMail({
    fromName: 'STEMfra Sites',
    to: owner.email,
    subject: `New chat lead from your website — ${lead.intent}`,
    text: [
      `Your website chat assistant captured a new lead.`,
      ``,
      `Name: ${lead.name || '(not given)'}`,
      `Email: ${lead.email || '(not given)'}`,
      `Phone: ${lead.phone || '(not given)'}`,
      ``,
      `What they wanted:`,
      lead.summary,
      ``,
      `See it in your dashboard under Leads.`,
    ].join('\n'),
    html: emails.ownerChatLeadNotification({
      name: lead.name, email: lead.email, phone: lead.phone,
      intent: lead.intent, summary: lead.summary, dashboardUrl,
    }),
  });
}

// One round-trip to the Front Desk n8n workflow. Returns the parsed agent output
// { reply, handoff, lead, booking }. `context` already includes the live site
// context + today + any booking_system_note for this call.
async function callFrontdesk({ convId, siteId, business, message, history, context }) {
  const headers = { 'Content-Type': 'application/json' };
  if (N8N_SECRET) headers['x-leadgen-secret'] = N8N_SECRET;
  const r = await fetch(FRONTDESK_N8N_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      conversationId: convId, siteId, agent: 'frontdesk',
      business, model: FRONTDESK_MODEL, message, history, context,
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Front desk workflow error (${r.status})`);
  return {
    reply: data.reply ?? data.output ?? '',
    handoff: !!data.handoff,
    lead: data.lead && typeof data.lead === 'object' ? data.lead : null,
    escalation: data.escalation && typeof data.escalation === 'object' ? data.escalation : null,
    list: data.list && typeof data.list === 'object' && data.list.source ? String(data.list.source) : null,
    booking: data.booking && typeof data.booking === 'object' ? data.booking : null,
    quickReplies: Array.isArray(data.quick_replies) ? data.quick_replies.filter(s => typeof s === 'string' && s.trim()).slice(0, 6) : [],
  };
}

// POST /api/site-chat/send  { siteId, conversationId?, message }
async function send(req, res) {
  try {
    const { siteId, conversationId, message, memberToken } = req.body || {};
    if (!siteId || !message || !String(message).trim()) return res.status(400).json({ error: 'message is required.' });

    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
    if (rateLimited(`${ip}:${siteId}`)) return res.status(429).json({ error: 'Too many messages — please slow down a moment.' });

    // Tenant: the site must exist and be live (or previewing, for testing).
    const { data: site } = await supabase.from('sites')
      .select('id, status, owner_contact_id, booking_mode, booking_config, payments_enabled, company:companies(name)')
      .eq('id', siteId).maybeSingle();
    if (!site || !['live', 'previewing'].includes(site.status)) return res.status(404).json({ error: 'Site not found.' });

    // Per-site opt-in: site_theme_settings.metadata.frontdesk_enabled === true.
    const { data: theme } = await supabase.from('site_theme_settings').select('metadata').eq('site_id', siteId).maybeSingle();
    if (!(theme?.metadata && theme.metadata.frontdesk_enabled === true)) {
      return res.status(403).json({ error: 'Chat is not enabled for this site.' });
    }

    if (!FRONTDESK_N8N_URL) return res.status(503).json({ error: 'The assistant is not configured yet.' });

    // Resume or create an anonymous conversation.
    let convId = conversationId;
    let history = [];
    let bookingState = null; // merged in-progress booking, persisted in tool_log
    if (convId) {
      const { data: conv } = await supabase.from('agent_conversations')
        .select('messages, tool_log').eq('id', convId).eq('site_id', siteId).eq('agent', 'frontdesk').maybeSingle();
      if (conv) {
        history = (conv.messages || []).slice(-12);
        bookingState = conv.tool_log?.booking_state || null;
      } else convId = null;
    }
    if (!convId) {
      const { data: created, error } = await supabase.from('agent_conversations')
        .insert({ site_id: siteId, agent: 'frontdesk', created_by: null, model: FRONTDESK_MODEL, title: String(message).trim().slice(0, 60), status: 'open' })
        .select('id').single();
      if (error) throw new Error(error.message);
      convId = created.id;
    }

    const baseContext = await buildSiteContext(siteId);

    // DEV-only: "/list services" renders a list card straight from real data,
    // bypassing the agent. Mirrors Stacy's "/demo" escape hatch — it lets the card
    // be iterated on without a workflow round-trip, and lets a fresh session confirm
    // the renderer works before the n8n prompt has been pasted. Never in production.
    const devList = process.env.NODE_ENV !== 'production' && /^\/list\s+(\w+)$/i.exec(String(message).trim());
    if (devList) {
      const demo = buildListCard(devList[1], baseContext);
      return res.json({
        reply: demo ? `Here is what we have.` : `Nothing to list for "${devList[1]}".`,
        conversationId: conversationId || null, card: demo, quick_replies: [],
      });
    }
    // Who are we talking to? Verified server-side from the member's own session.
    const member = await resolveMember(siteId, memberToken);
    const zone = baseContext.business?.time_zone || 'America/New_York';
    const today = DateTime.now().setZone(zone).toFormat("yyyy-MM-dd '('cccc')'");
    const business = site.company?.name || null;
    const userMsg = { role: 'user', content: String(message).trim(), ts: new Date().toISOString() };

    let reply = '';
    let lead = null;
    let escalation = null;      // refund / complaint / billing — never answered by the agent
    let listSource = null;      // 'services' | 'classes' | 'team' | 'hours' — the agent classifies, we build
    let card = null;            // structured booking card (confirm / done / handoff)
    let quickReplies = [];      // tappable chips shown under the reply
    let pendingPayment = null;  // resolved booking awaiting an in-chat card payment
    try {
      // Turn 1 — answer / gather. The agent may emit a `booking` intent.
      let out = await callFrontdesk({
        convId, siteId, business, message: userMsg.content, history,
        context: { ...baseContext, today, member: member
          ? { known: true, name: member.name, email: member.email, phone: member.phone }
          : { known: false } },
      });

      // F3 — if the agent is working a booking, run the real booking tool and
      // (when it produced a note) re-invoke once so the agent's reply is grounded
      // in real availability / a real confirmation. Capped at one extra round-trip.
      // The tool may also return a structured `card` and time `quickReplies`.
      if (out.booking) {
        // Merge with the in-progress booking so a turn that drops a field (the model
        // is inconsistent) doesn't lose it. New non-empty values win; `confirm` is
        // always taken fresh from this turn (never retained).
        bookingState = mergeBooking(bookingState, out.booking);
        const tool = await runBookingTool({ site, booking: bookingState, zone, userMessage: userMsg.content });
        if (tool.card) card = tool.card;
        if (tool.quickReplies?.length) quickReplies = tool.quickReplies;
        if (tool.pendingPayment) pendingPayment = tool.pendingPayment; // P3: awaiting card payment
        if (tool.card?.kind === 'booking_done') bookingState = null; // booked → clear
        if (tool.note) {
          out = await callFrontdesk({
            convId, siteId, business, message: userMsg.content, history,
            context: { ...baseContext, today, booking_system_note: tool.note, member: member
              ? { known: true, name: member.name, email: member.email, phone: member.phone }
              : { known: false } },
          });
        }
      }

      reply = out.reply;
      lead = out.lead;
      escalation = out.escalation;
      listSource = out.list;
      // Server-injected booking chips (exact times) win; else use the agent's chips.
      if (!quickReplies.length) quickReplies = out.quickReplies || [];
    } catch (e) {
      console.error('[site-chat.send] n8n error:', e.message);
      return res.status(502).json({ error: 'The assistant could not respond right now. Please try again.' });
    }

    await appendMessages(convId, [userMsg, { role: 'assistant', content: reply, ts: new Date().toISOString() }]);
    // Persist the in-progress booking (recover dropped fields next turn) + any
    // pending in-chat payment (so /complete-booking can finalize after the charge).
    await supabase.from('agent_conversations')
      .update({ tool_log: { booking_state: bookingState, pending_payment: pendingPayment } }).eq('id', convId);

    // F2 — if the agent gathered the visitor's details, capture a lead (best-effort,
    // never blocks or fails the reply).
    if (lead) captureLead(site, convId, lead).catch(e => console.error('[site-chat] captureLead error:', e.message));

    // Escalation — a refund, complaint or billing dispute the assistant is told
    // never to answer itself. Same best-effort discipline as leads: it must never
    // block or fail the visitor's reply.
    if (escalation) captureEscalation(site, convId, escalation, member)
      .catch(e => console.error('[site-chat] captureEscalation error:', e.message));

    // The agent only names WHAT it was asked to list; the rows come from the site's
    // own data so they can't be invented. A booking card always wins the slot — the
    // visitor is mid-flow and doesn't need a menu on top of it.
    if (!card && listSource) card = buildListCard(listSource, baseContext);

    // A card with its own controls (action buttons or a payment form) supersedes
    // chips — avoid a stale/duplicate chip row under it.
    if (card?.actions?.length || card?.kind === 'booking_payment') quickReplies = [];

    res.json({ reply, conversationId: convId, card, quick_replies: quickReplies });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/site-chat/complete-booking { siteId, conversationId, paymentIntentId }
// P3 — finalize an in-chat PAID booking after the Stripe charge succeeds. Reads the
// resolved booking from tool_log.pending_payment, verifies the PI matches, writes the
// booking (appointment or class — the cores re-verify the PI), clears pending state.
async function completeBooking(req, res) {
  try {
    const { siteId, conversationId, paymentIntentId } = req.body || {};
    if (!siteId || !conversationId || !paymentIntentId) return res.status(400).json({ error: 'Missing required fields.' });

    const { data: conv } = await supabase.from('agent_conversations')
      .select('tool_log').eq('id', conversationId).eq('site_id', siteId).eq('agent', 'frontdesk').maybeSingle();
    const pending = conv?.tool_log?.pending_payment;
    if (!pending) return res.status(409).json({ error: 'No booking is awaiting payment.' });
    if (pending.paymentIntentId !== paymentIntentId) return res.status(400).json({ error: 'Payment does not match this booking.' });

    const { data: site } = await supabase.from('sites').select('id, company:companies(name)').eq('id', siteId).maybeSingle();
    const bizName = site?.company?.name || 'Bookings';
    const c = pending.customer || {};
    const [firstName, ...rest] = String(c.name || '').trim().split(/\s+/);
    const customer = { firstName, lastName: rest.join(' ') || null, email: c.email || null, phone: c.phone || null };

    const r = pending.kind === 'class'
      ? await bookClassSession({ siteId, sessionId: pending.sessionId, customer, paymentIntentId, allowedStatuses: ALLOWED_CHAT, emailFromName: bizName })
      : await placeBooking({ siteId, teamMemberId: pending.teamMemberId, serviceId: pending.serviceId, date: pending.date, time: pending.time, customer, paymentIntentId, allowedStatuses: ALLOWED_CHAT, emailFromName: bizName });
    if (!r.ok) return res.status(r.code || 500).json({ error: r.message || 'Could not complete the booking.' });

    // Clear pending + in-progress booking state.
    await supabase.from('agent_conversations')
      .update({ tool_log: { booking_state: null, pending_payment: null } }).eq('id', conversationId);

    const reply = `Payment received — you're all set! Your ${pending.kind === 'class' ? 'class' : 'appointment'} is confirmed for ${r.booking.date} at ${r.booking.time}. A confirmation email is on the way.`;
    await appendMessages(conversationId, [{ role: 'assistant', content: reply, ts: new Date().toISOString() }]);

    res.json({
      reply,
      card: { kind: 'booking_done', title: "You're booked! 🎉", lines: pending.summary || [`${r.booking.date} · ${r.booking.time}`] },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * POST /api/site-chat/rewind  { siteId, conversationId, keep }
 * "Rewind to here" — truncate the persisted transcript to its first `keep`
 * messages so the agent's memory genuinely matches what the visitor now sees.
 * Without this the widget would only LOOK rewound while the agent still
 * remembered the discarded turns. Same trust model as /send: anonymous, but
 * scoped to the conversation's own site + agent.
 */
async function rewind(req, res) {
  try {
    const { siteId, conversationId, keep } = req.body || {};
    const n = Number(keep);
    if (!siteId || !conversationId || !Number.isInteger(n) || n < 0) {
      return res.status(400).json({ error: 'siteId, conversationId and keep are required.' });
    }
    const { data: conv } = await supabase
      .from('agent_conversations')
      .select('id, messages')
      .eq('id', conversationId).eq('site_id', siteId).eq('agent', 'frontdesk')
      .maybeSingle();
    if (!conv) return res.status(404).json({ error: 'Conversation not found.' });

    const messages = (conv.messages || []).slice(0, n);
    await supabase.from('agent_conversations').update({ messages }).eq('id', conversationId);
    res.json({ ok: true, kept: messages.length });
  } catch (err) {
    console.error('[siteChat.rewind]', err.message);
    res.status(500).json({ error: 'Could not rewind the conversation.' });
  }
}

module.exports = { send, completeBooking, rewind };
