// Front Desk (Agent 2), F1 = answer. The customer-facing chat widget on a
// client's template site. PUBLIC (no owner auth) — the tenant is the siteId the
// widget passes. Reuses Stacy's F1 context-builder (lib/stacyContext.js) and the
// same server→n8n proxy + x-leadgen-secret trust. Anonymous visitors: conversations
// are stored in agent_conversations with agent='frontdesk', created_by=null; the
// widget holds the conversationId as the session key.
//
// Single-var supabase require per the server convention.
const supabase = require('../config/supabase');
const nodemailer = require('nodemailer');
const { DateTime } = require('luxon');
const { buildSiteContext } = require('../lib/stacyContext');
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

async function notifyOwnerOfLead(site, lead) {
  if (!site.owner_contact_id || !process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) return;
  const { data: owner } = await supabase.from('contacts').select('email, full_name').eq('id', site.owner_contact_id).single();
  if (!owner?.email) return;
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  });
  await transporter.sendMail({
    from: `"STEMfra Sites" <${process.env.GMAIL_USER}>`,
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
    booking: data.booking && typeof data.booking === 'object' ? data.booking : null,
    quickReplies: Array.isArray(data.quick_replies) ? data.quick_replies.filter(s => typeof s === 'string' && s.trim()).slice(0, 6) : [],
  };
}

// POST /api/site-chat/send  { siteId, conversationId?, message }
async function send(req, res) {
  try {
    const { siteId, conversationId, message } = req.body || {};
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
    const zone = baseContext.business?.time_zone || 'America/New_York';
    const today = DateTime.now().setZone(zone).toFormat("yyyy-MM-dd '('cccc')'");
    const business = site.company?.name || null;
    const userMsg = { role: 'user', content: String(message).trim(), ts: new Date().toISOString() };

    let reply = '';
    let lead = null;
    let card = null;            // structured booking card (confirm / done / handoff)
    let quickReplies = [];      // tappable chips shown under the reply
    let pendingPayment = null;  // resolved booking awaiting an in-chat card payment
    try {
      // Turn 1 — answer / gather. The agent may emit a `booking` intent.
      let out = await callFrontdesk({
        convId, siteId, business, message: userMsg.content, history,
        context: { ...baseContext, today },
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
        const tool = await runBookingTool({ site, booking: bookingState, zone });
        if (tool.card) card = tool.card;
        if (tool.quickReplies?.length) quickReplies = tool.quickReplies;
        if (tool.pendingPayment) pendingPayment = tool.pendingPayment; // P3: awaiting card payment
        if (tool.card?.kind === 'booking_done') bookingState = null; // booked → clear
        if (tool.note) {
          out = await callFrontdesk({
            convId, siteId, business, message: userMsg.content, history,
            context: { ...baseContext, today, booking_system_note: tool.note },
          });
        }
      }

      reply = out.reply;
      lead = out.lead;
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

module.exports = { send, completeBooking };
