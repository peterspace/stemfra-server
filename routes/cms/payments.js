const express = require('express');
const router = express.Router();
const { requireCmsAuth } = require('../../middleware/cmsAuth');
const {
  healthcheck, connectLink, status, dashboardLink,
  saveKeys, getKeysStatus, deleteKeys,
} = require('../../controllers/cms/paymentsController');

// Public — config presence check
router.get('/healthcheck', healthcheck);

// Auth-gated (Stripe Connect Express onboarding + status — LEGACY, dormant)
router.post('/connect-link', requireCmsAuth, connectLink);
router.get('/status', requireCmsAuth, status);
router.post('/dashboard-link', requireCmsAuth, dashboardLink);

// P12 direct-keys: the business stores its OWN Stripe keys.
router.post('/keys', requireCmsAuth, saveKeys);
router.get('/keys', requireCmsAuth, getKeysStatus);
router.delete('/keys', requireCmsAuth, deleteKeys);

module.exports = router;
