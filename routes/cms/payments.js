const express = require('express');
const router = express.Router();
const { requireCmsAuth } = require('../../middleware/cmsAuth');
const { healthcheck, connectLink, status } = require('../../controllers/cms/paymentsController');

// Public — config presence check
router.get('/healthcheck', healthcheck);

// Auth-gated (Stripe Connect Express onboarding + status)
router.post('/connect-link', requireCmsAuth, connectLink);
router.get('/status', requireCmsAuth, status);

module.exports = router;
