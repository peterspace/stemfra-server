const express = require('express');
const router = express.Router();
const { requireCmsAuth } = require('../../middleware/cmsAuth');
const { getBilling, updateBillingContact, changePlan, cancelSubscription, reactivateSubscription, invoicePdf } = require('../../controllers/cms/billingController');

// Owner-facing System-A billing: see your Stemfra subscription + charges, edit
// billing details, change plan, cancel/reactivate, and download invoice PDFs.
router.get('/', requireCmsAuth, getBilling);
router.patch('/contact', requireCmsAuth, updateBillingContact);
router.post('/change-plan', requireCmsAuth, changePlan);
router.post('/cancel', requireCmsAuth, cancelSubscription);
router.post('/reactivate', requireCmsAuth, reactivateSubscription);
router.get('/charges/:chargeId/invoice', requireCmsAuth, invoicePdf);

module.exports = router;
