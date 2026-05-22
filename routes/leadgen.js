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
const supabase = require('../config/supabase');

const router = express.Router();

// Mirror of the CRM-known verticals → template slugs. Server-side validation so
// a bad vertical never reaches n8n / Apify as a wasted run.
const KNOWN_VERTICALS = new Set([
  'barbershop', 'beauty_salon', 'boutique_gym', 'crossfit', 'yoga_pilates',
]);

async function validateUserSession(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

// POST /api/leadgen/trigger
// Body: { system?: 'cold'|'warm', vertical, city, max_results?, min_score?, search_query? }
router.post('/trigger', async (req, res) => {
  const user = await validateUserSession(req);
  if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });

  const {
    system      = 'cold',
    vertical    = 'barbershop',
    city        = '',
    search_query,
    max_results = 30,
    min_score   = 5,
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

  const payload = {
    system,
    vertical,
    city,
    search_query: search_query || `${vertical.replace('_', ' ')} in ${city}`,
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
      details: { system, vertical, city, max_results: maxResults, min_score: minScore },
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

module.exports = router;
