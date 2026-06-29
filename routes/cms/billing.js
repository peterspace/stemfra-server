const express = require('express');
const router = express.Router();
const { requireCmsAuth } = require('../../middleware/cmsAuth');
const { getBilling, updateBillingContact } = require('../../controllers/cms/billingController');

// Owner-facing System-A billing: see your Stemfra subscription + charges, and
// provide the billing contact details we need for collection.
router.get('/', requireCmsAuth, getBilling);
router.patch('/contact', requireCmsAuth, updateBillingContact);

module.exports = router;
