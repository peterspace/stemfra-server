const express = require('express');
const router = express.Router();
const { requireStaffAuth } = require('../../middleware/staffAuth');
const { listSubscriptions, startCheckout, portalLink } = require('../../controllers/admin/subscriptionsController');

router.get('/', requireStaffAuth, listSubscriptions);
router.post('/:siteId/checkout', requireStaffAuth, startCheckout);
router.post('/:siteId/portal', requireStaffAuth, portalLink);

module.exports = router;
