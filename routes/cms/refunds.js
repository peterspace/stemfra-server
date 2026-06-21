const express = require('express');
const router = express.Router();
const { requireCmsAuth } = require('../../middleware/cmsAuth');
const { refund } = require('../../controllers/cms/refundsController');

// CMS — owner-issued refunds (bookings or subscriptions). Auth-gated.
router.post('/', requireCmsAuth, refund);

module.exports = router;
