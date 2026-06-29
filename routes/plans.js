// Public pricing catalog — the DB-driven plan prices (single source of truth),
// so the marketing pricing page never drifts from billing. Returns the same
// crm_settings.billing_plans the billing engine uses (setup + tier monthly_cents).
// Public + cacheable; contains only prices already shown publicly.
const express = require('express');
const supabase = require('../config/supabase');
const router = express.Router();

router.get('/', async (_req, res) => {
  try {
    const { data } = await supabase.from('crm_settings').select('value').eq('key', 'billing_plans').maybeSingle();
    res.set('Cache-Control', 'public, max-age=300');
    return res.json(data?.value || { currency: 'USD', setup_cents: 100000, tiers: {} });
  } catch {
    return res.status(500).json({ error: 'plans unavailable' });
  }
});

module.exports = router;
