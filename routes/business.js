// Endpoints for the stemfra_business app (staff-only business-plan / pitch-deck
// builder at localhost:5183). Document PERSISTENCE lives in the browser via the
// `business_documents` table + staff RLS (no server round-trip needed); this
// route only serves the AI DRAFTING copilot, which needs the server-held
// OPENAI_API_KEY. Gated by requireStaffAuth (any active @stemfra.com staff).
const express = require('express');
const router = express.Router();
const { requireStaffAuth } = require('../middleware/staffAuth');
const { isConfigured, assist, BUSINESS_MODEL } = require('../lib/businessAssist');

// GET /api/business/assist/healthcheck — is the copilot configured?
router.get('/assist/healthcheck', (req, res) => {
  res.json({ ok: true, configured: isConfigured(), model: BUSINESS_MODEL });
});

// POST /api/business/assist — draft or edit ONE block.
// Body: { mode: 'draft'|'edit', instruction, context?, blockType?, block? }
router.post('/assist', requireStaffAuth, async (req, res) => {
  try {
    const { mode, instruction, context, blockType, block } = req.body || {};
    if (mode !== 'draft' && mode !== 'edit') {
      return res.status(400).json({ error: "mode must be 'draft' or 'edit'" });
    }
    if (!isConfigured()) {
      return res.status(503).json({ error: 'AI assistant is not configured (OPENAI_API_KEY missing on the server).' });
    }
    const result = await assist(mode, { instruction, context, blockType, block });
    res.json({ block: result });
  } catch (err) {
    console.error('[business/assist] failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
