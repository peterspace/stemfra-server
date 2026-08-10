// US economic-nexus thresholds — the sales/transaction levels at which Stemfra
// would have to register + collect in a state. Server-side copy of the numbers
// the CRM shows (stemfra-ops complianceCatalog THRESHOLD_OVERRIDE) — kept here
// so the nexus sweeper can flag jurisdictions approaching a threshold WITHOUT
// pulling in the full client-side taxability catalog. Only the threshold
// NUMBERS live here; the taxability/rate logic stays in the CRM. Confirm with
// the CPA; update when a state changes its thresholds.
const DEFAULT_THRESHOLD = { salesUsd: 100000, txns: 200 };
const THRESHOLD_OVERRIDE = {
  'US-CA': { salesUsd: 500000, txns: null },
  'US-TX': { salesUsd: 500000, txns: null },
  'US-NY': { salesUsd: 500000, txns: 100 },
  'US-TN': { salesUsd: 100000, txns: null },
  'US-WA': { salesUsd: 100000, txns: null },
};

function thresholdFor(jurisdiction) {
  return THRESHOLD_OVERRIDE[jurisdiction] || DEFAULT_THRESHOLD;
}

// Fraction (0..) of the nearer prong (sales or transaction count) reached.
function nexusPct(jurisdiction, billedCents, invoiceCount) {
  const t = thresholdFor(jurisdiction);
  const salesPct = t.salesUsd ? (billedCents / 100) / t.salesUsd : 0;
  const txnPct = t.txns ? invoiceCount / t.txns : 0;
  return Math.max(salesPct, txnPct);
}

module.exports = { DEFAULT_THRESHOLD, THRESHOLD_OVERRIDE, thresholdFor, nexusPct };
