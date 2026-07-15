const express = require('express');
const router = express.Router();
const { marketingMockups } = require('../controllers/admin/mockupsController');
const { marketingAssets } = require('../controllers/admin/marketingAssetsController');
const { demoServices } = require('../controllers/marketingServicesController');

// Public marketing-site reads (no auth).
// GET /api/marketing/mockups — saved hero composites keyed by demo subdomain.
router.get('/mockups', marketingMockups);
// GET /api/marketing/assets — site imagery slots (marketing_assets table).
router.get('/assets', marketingAssets);
// GET /api/marketing/demo-services?subdomain= — a demo's service menu (Solutions marquee).
router.get('/demo-services', demoServices);

module.exports = router;
