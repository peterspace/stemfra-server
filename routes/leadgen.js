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
const { sendClaimEmail } = require('../lib/claimSend');

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

  // The active A1 outreach template (CRM → Email Templates) rides along so the
  // scoring agent drafts INSIDE the agreed structure — flow, self-serve CTA and
  // the literal {{demo_link}} / {{start_free_link}} merge fields intact (those
  // two are resolved at send time by send-outreach). Editing A1 in the CRM
  // retunes the agent on the next run; the Template Manager stays the single
  // source of truth. Best-effort: without it the agent falls back to freehand.
  let template_a1 = null;
  try {
    const { data: tpl } = await supabase
      .from('email_templates')
      .select('subject, body')
      .eq('code', 'A1')
      .eq('is_active', true)
      .maybeSingle();
    if (tpl) template_a1 = tpl;
  } catch { /* freehand fallback */ }

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
    template_a1,
    triggered_by: user.id,
    triggered_at: new Date().toISOString(),
  };

  // Coverage ledger (launch task #6): ONE leadgen_runs row per run, created
  // BEFORE the webhook so even a failed/empty run counts as "we tried this
  // city". `run_id` rides on the payload so n8n can stamp `leads.leadgen_run_id`
  // on every lead it inserts (n8n-workflows/leadgen-system-prompt.txt + the
  // Supabase insert node; Peter pastes). Derived counts on /coverage use it.
  let runId = null;
  try {
    const { data: run, error } = await supabase.from('leadgen_runs').insert({
      system, vertical, country: country || null, country_name: country_name || null,
      state_code: state_code || null, state_name: state_name || null, city: city || null,
      search_query: payload.search_query, max_results: maxResults, min_score: minScore,
      requested_by: user.id, status: 'requested',
    }).select('id').single();
    if (error) console.error('[leadgen] coverage run insert failed:', error.message);
    else { runId = run.id; payload.run_id = runId; }
  } catch (e) { console.error('[leadgen] coverage run insert threw:', e.message); }

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
      if (runId) await supabase.from('leadgen_runs').update({ status: 'failed', notes: `n8n ${r.status}` }).eq('id', runId).then(() => {}, () => {});
      return res.status(502).json({
        success: false,
        message: `Lead-gen workflow could not be started (n8n responded ${r.status}).`,
      });
    }

    // (The old activity_feed 'leadgen_run' insert was removed 2026-08-18: it never
    // landed, entity_type CHECK rejects it, so 0 rows in 2 months. The
    // leadgen_runs row above is the run record now.)

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
  // mode: 'claim' (default, launch 2026-08-19) sends the branded "Claim your
  // website" touch 1 (lib/claimSend.js); 'draft' sends the AI-drafted plain
  // text as before. Default comes from crm_settings.leadgen_first_touch.mode.
  const { leadId, subject: subjectOverride, message: messageOverride, mode: modeOverride } = req.body || {};
  if (!leadId) return res.status(400).json({ success: false, message: 'leadId is required.' });

  const { data: lead, error } = await supabase
    .from('leads')
    .select('*')
    .eq('id', leadId)
    .single();
  if (error || !lead) return res.status(404).json({ success: false, message: 'Lead not found.' });
  if (!lead.email) return res.status(400).json({ success: false, message: 'This lead has no email address.' });
  if (lead.outreach_status === 'sent' || lead.outreach_status === 'replied') {
    return res.status(409).json({ success: false, message: 'Outreach has already been sent for this lead.' });
  }
  if (lead.do_not_email) return res.status(409).json({ success: false, message: 'This lead has unsubscribed.' });

  let mode = modeOverride;
  if (!mode) {
    const { data: ft } = await supabase.from('crm_settings').select('value').eq('key', 'leadgen_first_touch').maybeSingle();
    mode = ft?.value?.mode || 'claim';
  }
  if (mode === 'claim') {
    try {
      const out = await sendClaimEmail(lead, { touch: 1, step: 1, byUserId: user.id });
      return res.json({ success: true, mode: 'claim', ...out, sentFrom: process.env.MARK_EMAIL || 'mark@stemfra.com' });
    } catch (err) {
      console.error('[leadgen] send-outreach (claim) error:', err.message);
      await supabase.from('leads').update({ outreach_status: 'failed' }).eq('id', leadId);
      return res.status(502).json({ success: false, message: `Could not send the Claim email: ${err.message}` });
    }
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
        // Funnel: opens also land in marketing_events (one table for the whole journey).
        if (!isPrefetch) supabase.from('marketing_events').insert({ lead_id: lead.id, event: 'email_open', user_agent: (req.headers['user-agent'] || '').slice(0, 300) }).then(() => {}, () => {});
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
  const { leadId, reason } = req.body || {};
  if (!leadId) return res.status(400).json({ success: false, message: 'leadId is required.' });

  const { data: lead, error } = await supabase
    .from('leads')
    .select('id, phone, phone_country, do_not_call, contact_name, company_name, pain_point_bucket, qualification, outreach_status, ai_draft_subject, ai_draft_message, outreach_reply_text, claim_token, outreach_sent_at, outreach_opened_at, outreach_step')
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
    const reasonText = typeof reason === 'string' ? reason.trim().slice(0, 500) : '';
    const { callSid, to } = await leadgenCall.placeAiCall(lead, { reason: reasonText || undefined });
    await supabase.from('activity_feed').insert([{
      entity_type: 'lead', entity_id: lead.id, action: 'lead_call_initiated',
      details: { call_sid: callSid, to, company_name: lead.company_name || null, trigger: 'manual', ...(reasonText ? { reason: reasonText } : {}) },
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

// ─── Coverage (launch task #6) ────────────────────────────────────────────────
// State-by-state record of where lead-gen has run. Runs come from /trigger
// (automatic) or POST /runs (a manually logged sweep, e.g. Mark's call list);
// per-run lead counts are DERIVED from leads.leadgen_run_id (found / contacted
// / converted) so nothing is double-entered.

const CONTACTED_STATUSES = new Set(['sent', 'opened', 'replied', 'called', 'bounced']);

// GET /api/leadgen/coverage?vertical=&country=&days=
router.get('/coverage', async (req, res) => {
  const user = await validateUserSession(req);
  if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });
  const { vertical = null, country = null, days = null } = req.query || {};
  try {
    let q = supabase.from('leadgen_runs').select('*').order('requested_at', { ascending: false }).limit(1000);
    if (vertical) q = q.eq('vertical', vertical);
    if (country) q = q.eq('country', country);
    if (days && Number(days) > 0) q = q.gte('requested_at', new Date(Date.now() - Number(days) * 86400_000).toISOString());
    const { data: runs, error } = await q;
    if (error) throw error;

    const ids = (runs || []).map((r) => r.id);
    const stats = {};
    if (ids.length) {
      const { data: leads } = await supabase
        .from('leads')
        .select('leadgen_run_id, outreach_status, outreach_sent_at, stage, review_status')
        .in('leadgen_run_id', ids);
      for (const l of leads || []) {
        const st = (stats[l.leadgen_run_id] ||= { found: 0, approved: 0, contacted: 0, converted: 0 });
        st.found += 1;
        if (l.review_status === 'approved') st.approved += 1;
        if (l.outreach_sent_at || CONTACTED_STATUSES.has(l.outreach_status)) st.contacted += 1;
        if (l.stage === 'won') st.converted += 1;
      }
    }

    // Per area rollup (vertical · country · state · city).
    const areas = {};
    const enriched = (runs || []).map((r) => {
      const st = stats[r.id] || { found: 0, approved: 0, contacted: 0, converted: 0 };
      const found = r.leads_found ?? st.found;
      const key = [r.vertical, r.country || '', r.state_code || r.state_name || '', (r.city || '').toLowerCase()].join('|');
      const a = (areas[key] ||= {
        vertical: r.vertical, country: r.country, state_code: r.state_code, state_name: r.state_name, city: r.city,
        runs: 0, last_run_at: null, found: 0, approved: 0, contacted: 0, converted: 0,
      });
      a.runs += 1;
      if (!a.last_run_at || r.requested_at > a.last_run_at) a.last_run_at = r.requested_at;
      a.found += found; a.approved += st.approved; a.contacted += st.contacted; a.converted += st.converted;
      return { ...r, found, approved: st.approved, contacted: st.contacted, converted: st.converted };
    });

    // Per state rollup for the map/list.
    const states = {};
    for (const a of Object.values(areas)) {
      const k = `${a.vertical}|${a.country || ''}|${a.state_code || a.state_name || ''}`;
      const s = (states[k] ||= { vertical: a.vertical, country: a.country, state_code: a.state_code, state_name: a.state_name, cities: 0, runs: 0, found: 0, contacted: 0, converted: 0, last_run_at: null });
      s.cities += 1; s.runs += a.runs; s.found += a.found; s.contacted += a.contacted; s.converted += a.converted;
      if (!s.last_run_at || (a.last_run_at && a.last_run_at > s.last_run_at)) s.last_run_at = a.last_run_at;
    }

    return res.json({ success: true, runs: enriched, areas: Object.values(areas), states: Object.values(states) });
  } catch (err) {
    console.error('[leadgen] coverage failed:', err.message);
    return res.status(500).json({ success: false, message: 'Could not load coverage.' });
  }
});

// POST /api/leadgen/runs — log a run manually (a hand-built list, a call sweep).
router.post('/runs', async (req, res) => {
  const user = await validateUserSession(req);
  if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });
  const { vertical, country = 'US', country_name = null, state_code = null, state_name = null, city = null, leads_found = null, notes = null, requested_at = null, system = 'manual' } = req.body || {};
  const known = KNOWN_VERTICALS instanceof Set ? KNOWN_VERTICALS.has(vertical) : Array.isArray(KNOWN_VERTICALS) ? KNOWN_VERTICALS.includes(vertical) : true;
  if (!vertical || !known) return res.status(400).json({ success: false, message: 'vertical is required.' });
  if (!city && !state_code && !state_name) return res.status(400).json({ success: false, message: 'city or state is required.' });
  const row = {
    system: ['cold', 'warm', 'manual'].includes(system) ? system : 'manual',
    vertical, country, country_name, state_code, state_name, city,
    leads_found: Number.isFinite(Number(leads_found)) && leads_found !== null && leads_found !== '' ? Number(leads_found) : null,
    notes: notes ? String(notes).slice(0, 2000) : null,
    status: 'completed', completed_at: new Date().toISOString(), requested_by: user.id,
    ...(requested_at ? { requested_at } : {}),
  };
  try {
    const { data, error } = await supabase.from('leadgen_runs').insert(row).select('*').single();
    if (error) return res.status(500).json({ success: false, message: error.message });
    return res.json({ success: true, run: data });
  } catch (err) { console.error('[leadgen] log run failed:', err.message); return res.status(500).json({ success: false, message: 'Could not log the run.' }); }
});

// PATCH /api/leadgen/runs/:id — status / notes / explicit count.
router.patch('/runs/:id', async (req, res) => {
  const user = await validateUserSession(req);
  if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });
  const { status, notes, leads_found } = req.body || {};
  const patch = {};
  if (status && ['requested', 'completed', 'failed', 'empty'].includes(status)) { patch.status = status; if (status !== 'requested') patch.completed_at = new Date().toISOString(); }
  if (notes !== undefined) patch.notes = notes ? String(notes).slice(0, 2000) : null;
  if (leads_found !== undefined) patch.leads_found = leads_found === null || leads_found === '' ? null : Number(leads_found);
  try {
    const { data, error } = await supabase.from('leadgen_runs').update(patch).eq('id', req.params.id).select('*').single();
    if (error) return res.status(500).json({ success: false, message: error.message });
    return res.json({ success: true, run: data });
  } catch (err) { console.error('[leadgen] update run failed:', err.message); return res.status(500).json({ success: false, message: 'Could not update the run.' }); }
});

// ─── Funnel (measurement from day 1) ─────────────────────────────────────────
// GET /api/leadgen/funnel?vertical=&days=&includeTest=
// One first-party report over leads + marketing_events: sent → opened → clicked
// (claim_page_view) → engaged (cta/see-live) → signup_start → signup_complete →
// published, plus replied / unsubscribed, and per-lead rows for drill-down.
router.get('/funnel', async (req, res) => {
  const user = await validateUserSession(req);
  if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });
  const { vertical = null, days = 90, includeTest = 'false' } = req.query || {};
  try {
    const since = new Date(Date.now() - Math.max(1, Number(days) || 90) * 86400_000).toISOString();
    let q = supabase.from('leads')
      .select('id, company_name, first_name, email, template_slug, region, stage, is_test, outreach_status, outreach_sent_at, outreach_step, outreach_opened_at, outreach_open_count, outreach_replied_at, do_not_email, contact_id, claim_token')
      .not('outreach_sent_at', 'is', null).gte('outreach_sent_at', since).order('outreach_sent_at', { ascending: false }).limit(2000);
    if (includeTest !== 'true') q = q.eq('is_test', false);
    const { data: leads, error } = await q;
    if (error) throw error;
    const ids = (leads || []).map((l) => l.id);
    const byLead = {};
    if (ids.length) {
      const { data: evs } = await supabase.from('marketing_events').select('lead_id, event, created_at').in('lead_id', ids).order('created_at', { ascending: true });
      for (const e of evs || []) { (byLead[e.lead_id] ||= {})[e.event] = (byLead[e.lead_id][e.event] || 0) + 1; (byLead[e.lead_id]._first ||= {})[e.event] ||= e.created_at; }
    }
    // Published: any live site owned by the lead's contact.
    const contactIds = (leads || []).map((l) => l.contact_id).filter(Boolean);
    const publishedByContact = new Set();
    if (contactIds.length) {
      const { data: sites } = await supabase.from('sites').select('owner_contact_id, status').in('owner_contact_id', contactIds).eq('status', 'live').is('deleted_at', null);
      for (const s of sites || []) publishedByContact.add(s.owner_contact_id);
    }
    const wantV = vertical ? require('../lib/verticalConfig').resolveVerticalSlug(vertical) : null;
    const rows = (leads || []).filter((l) => !wantV || require('../lib/verticalConfig').resolveVerticalSlug(l.template_slug || '') === wantV).map((l) => {
      const ev = byLead[l.id] || {};
      return {
        id: l.id, business: l.company_name, firstName: l.first_name, email: l.email, vertical: l.template_slug, state: l.region, stage: l.stage,
        sentAt: l.outreach_sent_at, step: l.outreach_step, status: l.outreach_status,
        opened: !!(l.outreach_opened_at || ev.email_open), opens: (l.outreach_open_count || 0) + (ev.email_open || 0),
        clicked: !!ev.claim_page_view, engaged: !!(ev.claim_cta_click || ev.claim_see_live_click),
        signupStart: !!ev.signup_start, signedUp: !!ev.signup_complete || l.stage === 'won',
        published: publishedByContact.has(l.contact_id), replied: !!l.outreach_replied_at, unsubscribed: !!l.do_not_email,
        touch2: !!ev.email_sent_touch2, firstClickAt: ev._first?.claim_page_view || null,
      };
    });
    const count = (k) => rows.filter((r) => r[k]).length;
    const totals = { sent: rows.length, opened: count('opened'), clicked: count('clicked'), engaged: count('engaged'), signupStart: count('signupStart'), signedUp: count('signedUp'), published: count('published'), replied: count('replied'), unsubscribed: count('unsubscribed'), touch2: count('touch2') };
    return res.json({ success: true, totals, rows });
  } catch (err) {
    console.error('[leadgen] funnel failed:', err.message);
    return res.status(500).json({ success: false, message: 'Could not load the funnel.' });
  }
});

module.exports = router;
