// expenseReceipts.js — the CRM's expense-receipt review surface (P17 in
// the CRM, 2026-08-31): list + on-demand scan + review edits (exclude
// personal spend, correct amounts, set renewal dates for the due-soon
// alerts). Staff-only; feeds the tax-prep books alongside `expenses`.
const express = require('express');
const supabase = require('../../config/supabase');
const { requireStaffAuth } = require('../../middleware/staffAuth');
const { scanAll, mailboxes } = require('../../lib/expenseScan');

const router = express.Router();

router.get('/', requireStaffAuth, async (req, res) => {
  const { data, error } = await supabase.from('expense_receipts')
    .select('*').order('received_at', { ascending: false }).limit(500);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ receipts: data, mailboxes: mailboxes().map((m) => m.user) });
});

let scanning = false;
router.post('/scan', requireStaffAuth, async (req, res) => {
  if (scanning) return res.status(409).json({ error: 'A scan is already running' });
  scanning = true;
  try {
    const results = await scanAll();
    res.json({ results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    scanning = false;
  }
});

router.patch('/:id', requireStaffAuth, async (req, res) => {
  const patch = {};
  for (const k of ['excluded', 'excluded_reason', 'renews_on', 'amount_cents', 'vendor', 'currency']) {
    if (k in (req.body || {})) patch[k] = req.body[k];
  }
  patch.updated_at = new Date().toISOString();
  const { data, error } = await supabase.from('expense_receipts')
    .update(patch).eq('id', req.params.id).select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ receipt: data });
});

module.exports = router;
