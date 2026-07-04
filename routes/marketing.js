const express = require('express');
const router = express.Router();
const { marketingMockups } = require('../controllers/admin/mockupsController');

// Public marketing-site reads (no auth).
// GET /api/marketing/mockups — saved hero composites keyed by demo subdomain.
router.get('/mockups', marketingMockups);

module.exports = router;
