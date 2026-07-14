const express = require('express');
const router = express.Router();
const { marketingMockups } = require('../controllers/admin/mockupsController');
const { marketingAssets } = require('../controllers/admin/marketingAssetsController');

// Public marketing-site reads (no auth).
// GET /api/marketing/mockups — saved hero composites keyed by demo subdomain.
router.get('/mockups', marketingMockups);
// GET /api/marketing/assets — site imagery slots (marketing_assets table).
router.get('/assets', marketingAssets);

module.exports = router;
