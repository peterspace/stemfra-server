// ─── Lead-Gen — trigger the n8n cold/warm lead-gen workflows ─────────────────
//
// Endpoints:
//   POST /api/leadgen/trigger — a CRM user kicks off a lead-gen run. The server
//                               validates the request, then fires the private
//                               n8n webhook (localhost on the VPS). n8n does the
//                               scrape → score → insert and writes leads back to
//                               Supabase as review_status='needs_review'.
//
// Why the server is in the middle (and not the CRM calling n8n directly):
//   - n8n is bound to 127.0.0.1:5678 on the VPS and is NOT publicly exposed.
//     Only same-host processes (this server) can reach it. Good — it keeps the
//     automation surface private.
//   - The server already holds the trust boundary (service-role Supabase, env
//     secrets). The CRM stays a thin client.
//
// Auth: standard Bearer JWT, same shape as the other authenticated endpoints.
//
// Env:
//   N8N_LEADGEN_COLD_URL  — full webhook URL for System B (cold/Google Maps),
//                           e.g. http://127.0.0.1:5678/webhook/leadgen-cold
//   N8N_LEADGEN_WARM_URL  — (later) System A (warm/Reddit+Yelp) webhook URL
//   N8N_WEBHOOK_SECRET    — optional shared secret sent as a header so n8n can
//                           reject anything that didn't come from this server.

const express  = require('express');
const crypto   = require('crypto');
const supabase = require('../config/supabase');
const { refineDraft, refineTemplate, isConfigured: leadgenAiConfigured } = require('../lib/leadgenDraft');
const gmailOutreach = require('../lib/gmailOutreach');
const leadgenCall = require('../lib/leadgenCall');
const { fillOutreachLinks } = require('../lib/demoLinks');

const router = express.Router();

// Server-side vertical allow-list (lead-gen slugs of non-deferred verticals) —
// sourced from the single vertical config so it never drifts.
const { KNOWN_VERTICALS } = require('../lib/verticalConfig');

async function validateUserSession(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

// POST /api/leadgen/trigger
// Body: {
//   system?: 'cold'|'warm', vertical, city,
//   country?:      string (ISO-2, e.g. 'US')
//   country_name?: string (e.g. 'United States')
//   state_code?:   string (e.g. 'NY')          — disambiguates same-named cities
//   state_name?:   string (e.g. 'New York')    — preferred over state_code in the
//                                                search_query when present
//   max_results?, min_score?, search_query?
// }
//
// Why both country/state names AND codes: the human-readable strings are
// what Google Maps actually wants in the query ("Brooklyn, New York, United
// States" disambiguates cleanly). The ISO codes are kept on the payload so
// the n8n workflow can branch / filter on them deterministically if needed.
router.post('/trigger', async (req, res) => {
  const user = await validateUserSession(req);
  if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });

  const {
    system       = 'cold',
    vertical     = 'barbershop',
    city         = '',
    country      = null,
    country_name = null,
    state_code   = null,
    state_name   = null,
    search_query,
    max_results  = 30,
    min_score    = 5,
  } = req.body || {};

  // ── Validate inputs (fail fast, before spending an Apify/Claude run) ──
  if (system !== 'cold' && system !== 'warm') {
    return res.status(400).json({ success: false, message: 'system must be "cold" or "warm".' });
  }
  if (!KNOWN_VERTICALS.has(vertical)) {
    return res.status(400).json({
      success: false,
      message: `Unknown vertical "${vertical}". Allowed: ${[...KNOWN_VERTICALS].join(', ')}.`,
    });
  }
  if (system === 'cold' && !city && !search_query) {
    return res.status(400).json({ success: false, message: 'A city or search_query is required for a cold run.' });
  }
  const maxResults = Math.min(Math.max(parseInt(max_results, 10) || 30, 1), 100); // clamp 1–100
  const minScore   = Math.min(Math.max(parseInt(min_score, 10) || 5, 1), 10);     // clamp 1–10

  // ── Pick the right n8n webhook ──
  const webhookUrl = system === 'cold'
    ? process.env.N8N_LEADGEN_COLD_URL
    : process.env.N8N_LEADGEN_WARM_URL;

  if (!webhookUrl) {
    return res.status(503).json({
      success: false,
      message: `Lead-gen (${system}) is not configured on the server yet.`,
    });
  }

  // Build the search_query Google Maps will see. If the caller passed an
  // explicit search_query, respect it. Otherwise compose one with as much
  // disambiguating context as we have. Examples:
  //   "barbershop in Brooklyn, New York, United States"   ← best
  //   "barbershop in Brooklyn, NY, United States"         ← fallback (no state name)
  //   "barbershop in Lagos, Nigeria"                      ← country with no states
  //   "barbershop in Brooklyn"                            ← legacy / no geo enrichment
  //
  // Preference order: full state name > state ISO code > nothing. The
  // country gets the same treatment.
  const verticalText = vertical.replace('_', ' ');
  const stateSegment   = state_name   || state_code   || null;
  const countrySegment = country_name || country      || null;
  const segments       = [city, stateSegment, countrySegment].filter(Boolean);
  const defaultQuery   = `${verticalText} in ${segments.join(', ')}`;

  const payload = {
    system,
    vertical,
    city,
    country,
    country_name,
    state_code,
    state_name,
    search_query: search_query || defaultQuery,
    max_results: maxResults,
    min_score:   minScore,
    triggered_by: user.id,
    triggered_at: new Date().toISOString(),
  };

  try {
    // Fire the n8n webhook. n8n runs the workflow and writes leads to Supabase
    // itself; we don't wait for the full scrape to finish (it can take a while),
    // so we use a short timeout and treat a kicked-off run as success. The
    // workflow's own Respond node returns quickly because the heavy work happens
    // in nodes that stream; if your n8n runs synchronously and is slow, raise
    // this timeout or switch the workflow to responseMode: 'onReceived'.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);

    const headers = { 'Content-Type': 'application/json' };
    if (process.env.N8N_WEBHOOK_SECRET) {
      headers['x-leadgen-secret'] = process.env.N8N_WEBHOOK_SECRET;
    }

    const r = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!r.ok) {
      const text = await r.text().catch(() => '');
      console.error('[leadgen] n8n webhook returned', r.status, text);
      return res.status(502).json({
        success: false,
        message: `Lead-gen workflow could not be started (n8n responded ${r.status}).`,
      });
    }

    // Log the run to the activity feed (best-effort, fail silent)
    await supabase.from('activity_feed').insert([{
      entity_type: 'leadgen_run',
      action: 'triggered',
      details: {
        system, vertical, city,
        country, country_name, state_code, state_name,
        search_query: payload.search_query,
        max_results: maxResults, min_score: minScore,
      },
      created_by: user.id,
    }]).catch(() => {});

    return res.status(202).json({
      success: true,
      message: `Lead-gen ${system} run started for ${vertical}${city ? ` in ${city}` : ''}. New leads will appear in the review queue shortly.`,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      // The run was kicked off but n8n is taking a while to respond — that's
      // usually fine, the workflow keeps running and writes leads when done.
      console.warn('[leadgen] n8n webhook timed out waiting for response (run likely still in progress)');
      return res.status(202).json({
        success: true,
        message: 'Lead-gen run started (still processing). Check the review queue in a few minutes.',
      });
    }
    console.error('[leadgen] trigger error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─── POST /api/leadgen/refine-draft ──────────────────────────────────────────
// AI-assist the reviewer's outreach draft in the CRM Review Queue. Synchronous
// GPT call (no n8n) so the refine feels instant. Body:
//   { channel, subject?, message, instruction, lead: { company_name, contact_name,
//     vertical, region, pain_point_bucket, qualification } }
// Returns { success, subject?, message }.
router.post('/refine-draft', async (req, res) => {
  const user = await validateUserSession(req);
  if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });
  if (!leadgenAiConfigured()) {
    return res.status(503).json({ success: false, message: 'AI drafting is not configured on the server (OPENAI_API_KEY missing).' });
  }

  const { channel, subject, message, instruction, lead, senderName } = req.body || {};
  if (!instruction || !String(instruction).trim()) {
    return res.status(400).json({ success: false, message: 'An instruction is required.' });
  }
  if (!message && !subject) {
    return res.status(400).json({ success: false, message: 'Nothing to refine.' });
  }

  try {
    const result = await refineDraft({
      channel,
      subject: subject ? String(subject) : '',
      message: message ? String(message) : '',
      instruction: String(instruction).slice(0, 500),
      lead: lead && typeof lead === 'object' ? lead : {},
      senderName: senderName ? String(senderName).slice(0, 80) : '',
    });
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('[leadgen] refine-draft error:', err.message);
    return res.status(502).json({ success: false, message: 'Could not refine the draft right now.' });
  }
});

// ─── POST /api/leadgen/send-outreach ─────────────────────────────────────────
// Send a lead's approved draft AS the logged-in rep (Gmail, domain-wide
// delegation). Marks the lead sent + stores the Gmail message/thread id so a
// reply can later flip it warm (Phase 2). Body: { leadId }.
router.post('/send-outreach', async (req, res) => {
  const user = await validateUserSession(req);
  if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });
  if (!gmailOutreach.isConfigured()) {
    return res.status(503).json({ success: false, message: 'Outreach email is not configured on the server (Google service account missing).' });
  }

  // subject/message overrides carry the reviewer's latest (possibly unsaved) edits.
  const { leadId, subject: subjectOverride, message: messageOverride } = req.body || {};
  if (!leadId) return res.status(400).json({ success: false, message: 'leadId is required.' });

  const { data: lead, error } = await supabase
    .from('leads')
    .select('id, email, contact_name, company_name, template_slug, ai_draft_subject, ai_draft_message, outreach_status')
    .eq('id', leadId)
    .single();
  if (error || !lead) return res.status(404).json({ success: false, message: 'Lead not found.' });
  if (!lead.email) return res.status(400).json({ success: false, message: 'This lead has no email address.' });
  if (lead.outreach_status === 'sent' || lead.outreach_status === 'replied') {
    return res.status(409).json({ success: false, message: 'Outreach has already been sent for this lead.' });
  }
  let text = String(messageOverride != null ? messageOverride : (lead.ai_draft_message || '')).trim();
  if (!text) return res.status(400).json({ success: false, message: 'This lead has no draft message to send.' });
  // Resolve {{demo_link}} / {{start_free_link}} to the vertical's live demo + pricing.
  text = fillOutreachLinks(text, { templateSlug: lead.template_slug });

  // Sender = "Mark" — the one consistent outreach identity (email + voice), sent
  // server-side via the service account impersonating mark@stemfra.com.
  const MARK_EMAIL = process.env.MARK_EMAIL || 'mark@stemfra.com';
  const markPhone = process.env.VOICE_PHONE_NUMBER || '';
  const contactLine = [markPhone, MARK_EMAIL].filter(Boolean).join(' · ');
  const signature = `\n\nMark\nStemfra\n${contactLine}`;
  const finalText = text.includes(MARK_EMAIL) ? text : text + signature;

  const subject = String(subjectOverride != null ? subjectOverride : (lead.ai_draft_subject || '')).trim()
    || `A quick note for ${lead.company_name || 'your business'}`;

  // Open-tracking pixel: a per-lead token → an HTML pixel that hits /o/:token when
  // the recipient's client loads images. Only enabled when PUBLIC_BASE_URL is set
  // (so the pixel URL is publicly reachable); otherwise we send plain text.
  const base = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  const trackToken = base ? crypto.randomBytes(16).toString('hex') : null;
  const pixelUrl = trackToken ? `${base}/api/leadgen/o/${trackToken}.gif` : null;

  try {
    const { messageId, threadId } = await gmailOutreach.sendAsRep({ repEmail: MARK_EMAIL, repName: 'Mark', to: lead.email, subject, text: finalText, pixelUrl });
    await supabase.from('leads').update({
      outreach_status:     'sent',
      outreach_step:       1,                      // A1 = step 1 of the sequence
      outreach_last_step_at: new Date().toISOString(),
      outreach_sent_at:    new Date().toISOString(),
      outreach_sent_by:    user.id,
      outreach_message_id: messageId,
      outreach_thread_id:  threadId,
      outreach_track_token: trackToken,           // null when tracking is disabled
      ai_draft_subject:    subject,               // persist exactly what was sent
      ai_draft_message:    finalText,
      review_status:       'approved',            // sending implies approval
      last_activity_at:    new Date().toISOString(),
    }).eq('id', leadId);
    return res.json({ success: true, messageId, threadId, sentFrom: MARK_EMAIL });
  } catch (err) {
    console.error('[leadgen] send-outreach error:', err.message);
    await supabase.from('leads').update({ outreach_status: 'failed' }).eq('id', leadId);
    return res.status(502).json({ success: false, message: 'Could not send the email right now.' });
  }
});

// ─── GET /api/leadgen/o/:token(.gif) ─────────────────────────────────────────
// PUBLIC open-tracking pixel. The recipient's mail client loads this 1x1 image
// when it renders our outreach email → we record the open on the matching lead.
// Always returns the transparent GIF (never blocks on the DB write). First open
// stamps outreach_opened_at + logs an activity row; every open bumps the count.
//
// Caveats (directional, not exact): Gmail proxies/caches images (an open may
// register once via Google's proxy), and Apple Mail Privacy Protection pre-fetches
// images — which can inflate opens. Good for aggregate trends, not per-recipient
// certainty. We treat opens within 8s of send as likely prefetch and don't stamp
// the "first open" from them (still counted, so the trend line stays honest).
const TRANSPARENT_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
router.get('/o/:token', (req, res) => {
  const token = String(req.params.token || '').replace(/\.(gif|png|jpg)$/i, '');
  // Fire-and-forget the DB write; the pixel must return instantly regardless.
  if (token) {
    (async () => {
      try {
        const { data: lead } = await supabase
          .from('leads')
          .select('id, outreach_open_count, outreach_opened_at, outreach_sent_at, company_name, outreach_sent_by')
          .eq('outreach_track_token', token)
          .maybeSingle();
        if (!lead) return;
        const now = Date.now();
        const sentAt = lead.outreach_sent_at ? new Date(lead.outreach_sent_at).getTime() : 0;
        const isPrefetch = sentAt && (now - sentAt) < 8000;           // likely Apple/Gmail prefetch
        const firstRealOpen = !lead.outreach_opened_at && !isPrefetch;
        const nowIso = new Date(now).toISOString();
        await supabase.from('leads').update({
          outreach_open_count:     (lead.outreach_open_count || 0) + 1,
          outreach_last_opened_at: nowIso,
          ...(firstRealOpen ? { outreach_opened_at: nowIso } : {}),
        }).eq('id', lead.id);
        if (firstRealOpen) {
          await supabase.from('activity_feed').insert([{
            entity_type: 'lead', entity_id: lead.id, action: 'email_opened',
            details: { company_name: lead.company_name || null }, created_by: lead.outreach_sent_by || null,
          }]).then(() => {}, () => {});
        }
      } catch { /* never let tracking break the pixel */ }
    })();
  }
  res.set('Content-Type', 'image/gif');
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  return res.end(TRANSPARENT_GIF);
});

// ─── POST /api/leadgen/call-with-ai ──────────────────────────────────────────
// Phase 3 (escalate) — place an outbound AI voice follow-up to a warm lead.
// Staff-initiated; reuses the Stemfra Voice engine. Body: { leadId }.
router.post('/call-with-ai', async (req, res) => {
  const user = await validateUserSession(req);
  if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });
  if (!leadgenCall.isConfigured()) {
    return res.status(503).json({ success: false, message: 'Outbound voice is not configured on the server.' });
  }
  const { leadId } = req.body || {};
  if (!leadId) return res.status(400).json({ success: false, message: 'leadId is required.' });

  const { data: lead, error } = await supabase
    .from('leads')
    .select('id, phone, phone_country, do_not_call, contact_name, company_name, pain_point_bucket, qualification, outreach_status, ai_draft_subject, ai_draft_message, outreach_reply_text')
    .eq('id', leadId)
    .single();
  if (error || !lead) return res.status(404).json({ success: false, message: 'Lead not found.' });
  if (lead.do_not_call) {
    return res.status(403).json({ success: false, message: 'This lead is on the Do Not Call list.' });
  }
  if (!leadgenCall.toE164(lead.phone, lead.phone_country)) {
    return res.status(400).json({ success: false, message: 'This lead has no usable phone number.' });
  }

  try {
    const { callSid, to } = await leadgenCall.placeAiCall(lead);
    await supabase.from('activity_feed').insert([{
      entity_type: 'lead', entity_id: lead.id, action: 'lead_call_initiated',
      details: { call_sid: callSid, to, company_name: lead.company_name || null, trigger: 'manual' },
      created_by: user.id,
    }]).then(() => {}, () => {});
    await supabase.from('leads').update({ last_activity_at: new Date().toISOString() }).eq('id', leadId);
    return res.json({ success: true, callSid, to });
  } catch (err) {
    console.error('[leadgen] call-with-ai error:', err.message);
    return res.status(502).json({ success: false, message: err.message || 'Could not place the call.' });
  }
});

// ─── POST /api/leadgen/refine-template ───────────────────────────────────────
// AI-assist editing an email TEMPLATE in the CRM Template Manager (keeps merge
// fields intact, self-serve CTA). Body: { subject?, body, instruction }.
router.post('/refine-template', async (req, res) => {
  const user = await validateUserSession(req);
  if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });
  if (!leadgenAiConfigured()) {
    return res.status(503).json({ success: false, message: 'AI is not configured (OPENAI_API_KEY missing).' });
  }
  const { subject, body, instruction } = req.body || {};
  if (!instruction || !String(instruction).trim()) {
    return res.status(400).json({ success: false, message: 'An instruction is required.' });
  }
  if (!body && !subject) return res.status(400).json({ success: false, message: 'Nothing to refine.' });
  try {
    const result = await refineTemplate({
      subject: subject ? String(subject) : '',
      body: body ? String(body) : '',
      instruction: String(instruction).slice(0, 500),
    });
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('[leadgen] refine-template error:', err.message);
    return res.status(502).json({ success: false, message: 'Could not refine the template right now.' });
  }
});

module.exports = router;
