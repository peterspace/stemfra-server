// Airwallex deposit webhook (Recon R2 — docs/RECONCILIATION.md).
// Registered in the Airwallex dashboard as `stemfra-deposit-recon`
// (wh_ZdHo8XuYvrmYaz3FrTdpjMczj_b3sBWM) → https://api.stemfra.com/api/awx/webhook
// with the four deposit.* events. Mounted with express.raw BEFORE the global
// express.json (same precedent as /api/stripe/webhook): the signature is
// HMAC-SHA256 over (x-timestamp + raw body) with AIRWALLEX_WEBHOOK_SECRET,
// compared against the x-signature header.
//
// Airwallex retries until it gets a 200, so: verify → 200 immediately →
// process async. reconcileDeposit is idempotent (recon_deposits is the dedup
// ledger), which makes redelivery safe.
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { reconcileDeposit } = require('../lib/reconEngine');
const { readReconSettings } = require('../lib/reconSweeper');

const TOLERANCE_MS = 5 * 60 * 1000; // replay window

function verifySignature(req) {
  const secret = process.env.AIRWALLEX_WEBHOOK_SECRET;
  if (!secret) return { ok: false, why: 'secret not configured' };
  const timestamp = req.header('x-timestamp');
  const signature = req.header('x-signature');
  if (!timestamp || !signature) return { ok: false, why: 'missing signature headers' };
  if (Math.abs(Date.now() - Number(timestamp)) > TOLERANCE_MS) return { ok: false, why: 'timestamp outside tolerance' };
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body);
  const expected = crypto.createHmac('sha256', secret).update(timestamp + raw).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, why: 'signature mismatch' };
  return { ok: true, raw };
}

router.post('/', async (req, res) => {
  const v = verifySignature(req);
  if (!v.ok) {
    console.warn('[awx-webhook] rejected:', v.why);
    return res.status(401).json({ error: 'invalid signature' });
  }

  let event;
  try { event = JSON.parse(v.raw); } catch { return res.status(400).json({ error: 'invalid JSON' }); }

  // Ack fast; Airwallex retries anything that is not a 200.
  res.json({ received: true });

  const name = event?.name || '';
  if (!name.startsWith('deposit.')) return; // only deposit.* is subscribed; ignore anything else
  const dep = event?.data;
  if (!dep?.id) return;

  try {
    // Respect the same gates as the sweeper: env kill switch + CRM dry_run.
    if (process.env.RECON_ENABLED !== 'true') {
      console.log(`[awx-webhook] ${name} received but RECON_ENABLED!=true — ignored (deposit ${dep.id})`);
      return;
    }
    const s = await readReconSettings();
    const out = await reconcileDeposit(dep, { dryRun: s.dry_run !== false, nearToleranceCents: s.near_tolerance_cents });
    console.log(`[awx-webhook] ${name} → ${JSON.stringify(out)}`);
  } catch (e) {
    // Already acked; the periodic sweep is the backstop for anything dropped here.
    console.error('[awx-webhook] processing failed:', e.message);
  }
});

module.exports = router;
