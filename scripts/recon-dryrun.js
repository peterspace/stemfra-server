// Recon R1 validation: fetch REAL deposits from the live Airwallex account and
// run the matcher in DRY-RUN (records rows in recon_deposits, marks nothing
// paid). Usage: node -r dotenv/config scripts/recon-dryrun.js [lookbackDays]
const { reconcileWindow } = require('../lib/reconEngine');

(async () => {
  const lookbackDays = Number(process.argv[2]) || 120;
  console.log(`Recon DRY-RUN — lookback ${lookbackDays} days\n`);
  const out = await reconcileWindow({ lookbackDays, dryRun: true });
  console.log(`Deposits fetched: ${out.deposits} · open charges: ${out.openCharges}\n`);
  for (const r of out.results) {
    if (r.error) { console.log(`✗ ${r.id}: ERROR ${r.error}`); continue; }
    console.log(`• ${r.status} ${r.currency} ${r.amount} | payer: ${r.payer || '—'} | ref: ${r.reference || '—'}`);
    console.log(`  → ${JSON.stringify(r.outcome)}`);
  }
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
