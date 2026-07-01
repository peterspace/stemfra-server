// Staff "buy a domain" routes (P6.27). Registrar = Porkbun (env-gated, inert
// until keys set). Gated by PLATFORM_OPS (same as the Sites admin), since buying
// touches money + customer site config. See docs/DOMAINS.md.
const express = require('express');
const router = express.Router();
const { requireStaffRole, PLATFORM_OPS } = require('../../middleware/staffAuth');
const { healthcheck, search, requirements, registerDomain } = require('../../controllers/admin/domainsController');

const gate = requireStaffRole(...PLATFORM_OPS);

router.get('/healthcheck', gate, healthcheck);
router.get('/search', gate, search);
router.get('/requirements', gate, requirements);
router.post('/:siteId/register', gate, registerDomain);

module.exports = router;
