const express = require('express');
const router = express.Router();
const { requireCmsAuth } = require('../../middleware/cmsAuth');
const { getReadiness, publish, unpublish, billingCheckout } = require('../../controllers/cms/publishController');

// All auth-gated + ownership-checked in the controller.
router.get('/readiness/:siteId', requireCmsAuth, getReadiness);
router.post('/publish', requireCmsAuth, publish);
router.post('/unpublish', requireCmsAuth, unpublish);
router.post('/billing-checkout', requireCmsAuth, billingCheckout);

module.exports = router;
