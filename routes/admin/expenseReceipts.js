// expenseReceipts.js — the CRM's expense-receipt review surface (P17 in
// the CRM, 2026-08-31): list + on-demand scan + review edits (exclude
// personal spend, correct amounts, set renewal dates for the due-soon
// alerts). Staff-only; feeds the tax-prep books alongside `expenses`.
const express = require('express');
const crypto = require('crypto');
const supabase = require('../../config/supabase');
const { requireStaffAuth } = require('../../middleware/staffAuth');
const { scanAll, mailboxes } = require('../../lib/expenseScan');
const { cloudinary, isCloudinaryConfigured } = require('../../config/cloudinary');

const router = express.Router();

// Manual entry (Peter, 2026-08-31): some invoices never arrive by email
// with a usable attachment (e.g. Northwest Registered Agent bills the
// card as "Corporate Filings LLC" and the invoice lives only in their
// dashboard). Staff add the expense by hand and attach the downloaded
// invoice; account='manual' marks the provenance.
router.post('/', requireStaffAuth, async (req, res) => {
  const { vendor, amount_cents, currency, received_at, renews_on, subject } = req.body || {};
  if (!vendor || !String(vendor).trim()) return res.status(400).json({ error: 'Vendor is required.' });
  const cents = Number(amount_cents);
  if (!Number.isFinite(cents) || cents <= 0) return res.status(400).json({ error: 'Enter the amount.' });
  const { data, error } = await supabase.from('expense_receipts').insert({
    account: 'manual',
    message_id: `manual-${crypto.randomUUID()}`,
    vendor: String(vendor).trim().slice(0, 120),
    subject: subject ? String(subject).trim().slice(0, 300) : 'Manually added expense',
    amount_cents: Math.round(cents),
    currency: ['USD', 'GBP', 'EUR'].includes(currency) ? currency : 'USD',
    received_at: received_at ? new Date(received_at).toISOString() : new Date().toISOString(),
    renews_on: renews_on || null,
    excluded: false,
  }).select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ receipt: data });
});

// Attach/replace the receipt file on ANY row (manual invoices, or the
// dashboard-downloaded PDF for a scanned email that had no attachment).
// PDFs and images accepted; stored as originals (same Cloudinary rules
// as the scanner; PDF delivery needs the account security checkbox).
router.post('/:id/receipt', requireStaffAuth, (req, res) => {
  if (!isCloudinaryConfigured()) return res.status(503).json({ error: 'Receipt storage is not configured.' });
  if (!req.busboy) return res.status(400).json({ error: 'multipart form required' });
  let handled = false;
  req.busboy.on('file', (name, file, info) => {
    if (handled) return file.resume();
    handled = true;
    const mime = String(info.mimeType || '');
    if (!/^(application\/pdf|image\/)/.test(mime)) {
      file.resume();
      return res.status(400).json({ error: 'PDF or image files only.' });
    }
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: 'stemfra_assets/expense-receipts',
        public_id: `r-${String(req.params.id).replace(/[^a-z0-9-]/gi, '')}`,
        resource_type: 'image',
        overwrite: true,
      },
      async (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        const { data, error } = await supabase.from('expense_receipts')
          .update({ attachment_url: result.secure_url, attachment_name: info.filename || 'receipt', updated_at: new Date().toISOString() })
          .eq('id', req.params.id).select('*').single();
        if (error) return res.status(500).json({ error: error.message });
        res.json({ receipt: data });
      },
    );
    file.pipe(stream);
  });
  req.busboy.on('error', () => { if (!res.headersSent) res.status(500).json({ error: 'upload failed' }); });
  req.busboy.on('finish', () => { if (!handled && !res.headersSent) res.status(400).json({ error: 'no file received' }); });
  req.pipe(req.busboy);
});

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

// Bulk include/exclude (the header "All" checkbox).
router.post('/bulk', requireStaffAuth, async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.slice(0, 500) : [];
  const excluded = !!req.body?.excluded;
  if (!ids.length) return res.status(400).json({ error: 'ids required' });
  const { error } = await supabase.from('expense_receipts')
    .update({ excluded, updated_at: new Date().toISOString() }).in('id', ids);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ updated: ids.length, excluded });
});

// Manual rows only: a mistyped manual entry can be removed outright.
// Scanned rows are never deleted (exclude them instead) so the mailbox
// history stays reproducible.
router.delete('/:id', requireStaffAuth, async (req, res) => {
  const { data: row } = await supabase.from('expense_receipts')
    .select('id, account').eq('id', req.params.id).maybeSingle();
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.account !== 'manual') return res.status(400).json({ error: 'Only manually added expenses can be deleted. Exclude scanned rows instead.' });
  const { error } = await supabase.from('expense_receipts').delete().eq('id', row.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
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
