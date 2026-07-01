// Registrar provider selector (P6.27). Porkbun is the only provider today; this
// seam lets us add Cloudflare Registrar / Namecheap later without touching callers
// (mirrors lib/billing's provider pattern). DOMAIN_REGISTRAR selects.
const porkbun = require('./porkbun');

const PROVIDERS = { porkbun };

function active() {
  return PROVIDERS[process.env.DOMAIN_REGISTRAR || 'porkbun'] || porkbun;
}

module.exports = { active, PROVIDERS, porkbun };
