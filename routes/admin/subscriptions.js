const express = require('express');
const router = express.Router();
const { requireStaffRole, PLATFORM_ADMIN } = require('../../middleware/staffAuth');
const { listSubscriptions, startCheckout, portalLink } = require('../../controllers/admin/subscriptionsController');

const gate = requireStaffRole(...PLATFORM_ADMIN);

router.get('/', gate, listSubscriptions);
router.post('/:siteId/checkout', gate, startCheckout);
router.post('/:siteId/portal', gate, portalLink);

module.exports = router;
