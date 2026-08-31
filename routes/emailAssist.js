// emailAssist.js — /api/admin/email-assist: AI refine + draft for the CRM
// email composer (staff-only). Logic in lib/emailAssist.js.
const express = require('express');
const { requireStaffAuth } = require('../middleware/staffAuth');
const { refineEmailHtml, draftEmail } = require('../lib/emailAssist');

const router = express.Router();

router.post('/refine', requireStaffAuth, async (req, res) => {
  const out = await refineEmailHtml(req.body?.html, req.body?.instruction);
  if (out.error) return res.status(422).json({ error: out.error });
  res.json(out);
});

router.post('/draft', requireStaffAuth, async (req, res) => {
  const { instruction, to, subject, context } = req.body || {};
  const out = await draftEmail({ instruction, to, subject, context });
  if (out.error) return res.status(422).json({ error: out.error });
  res.json(out);
});

module.exports = router;
