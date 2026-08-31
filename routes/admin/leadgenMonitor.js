// leadgenMonitor.js — the stemfra CRM's window into the Lead-Gen product
// (P23 item 3): proxies leads-api's shared-secret /api/ops/monitor so
// staff see per-tenant health without the CRM ever holding the other
// service's credentials. Read-only; actions come with the billing arc.
const express = require('express');
const { requireStaffAuth } = require('../../middleware/staffAuth');

const router = express.Router();

const LEADGEN_API_URL = process.env.LEADGEN_API_URL
  || (process.env.NODE_ENV === 'production' ? 'https://leads-api.stemfra.com' : 'http://localhost:4290');

router.get('/', requireStaffAuth, async (req, res) => {
  const secret = process.env.LEADGEN_OPS_SECRET;
  if (!secret) return res.status(503).json({ error: 'LEADGEN_OPS_SECRET not configured on this server.' });
  try {
    const r = await fetch(`${LEADGEN_API_URL}/api/ops/monitor`, {
      headers: { 'x-ops-secret': secret },
      signal: AbortSignal.timeout(15000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) {
      return res.status(502).json({ error: j.message || `Lead-Gen API returned ${r.status}` });
    }
    res.json(j);
  } catch (e) {
    res.status(502).json({ error: `Could not reach the Lead-Gen API: ${e.message}` });
  }
});

module.exports = router;
