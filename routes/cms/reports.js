const express = require('express');
const router = express.Router();
const { requireCmsAuth } = require('../../middleware/cmsAuth');
const { getReport, exportReport } = require('../../controllers/cms/reportsController');

// Owner Reports (Task #26). Owner-auth + per-site owned. Reports only — never
// computes taxes owed.
router.get('/', requireCmsAuth, getReport);          // ?siteId=&from=&to= → summary
router.get('/export', requireCmsAuth, exportReport); // ?siteId=&from=&to= → CSV for the accountant

module.exports = router;
