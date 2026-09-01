const express = require('express');
const router = express.Router();
const { requireCmsAuth } = require('../../middleware/cmsAuth');
const { getReadiness, publish, unpublish, billingCheckout, requestPublishInvoice, getSampleStatus, getQuality } = require('../../controllers/cms/publishController');

// All auth-gated + ownership-checked in the controller.
router.get('/readiness/:siteId', requireCmsAuth, getReadiness);
router.get('/sample-status/:siteId', requireCmsAuth, getSampleStatus);
router.get('/quality/:siteId', requireCmsAuth, getQuality);
router.post('/publish', requireCmsAuth, publish);
router.post('/unpublish', requireCmsAuth, unpublish);
router.post('/billing-checkout', requireCmsAuth, billingCheckout); // Stripe (gated off for now)
router.post('/request-invoice', requireCmsAuth, requestPublishInvoice); // Payoneer invoice-to-publish

module.exports = router;
