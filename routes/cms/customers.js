const express = require('express');
const router = express.Router();
const { requireCmsAuth } = require('../../middleware/cmsAuth');
const { setSuspended, listCustomers, exportCustomers, importPreview, importCustomers } = require('../../controllers/cms/customersController');

// Customer book + CSV import/export (Task #25). All owner-auth + per-site owned.
router.get('/', requireCmsAuth, listCustomers);                    // ?siteId= → list
router.get('/export', requireCmsAuth, exportCustomers);            // ?siteId= → CSV download
router.post('/import/preview', requireCmsAuth, importPreview);     // { siteId, rows } → dry-run counts
router.post('/import', requireCmsAuth, importCustomers);           // { siteId, rows } → { created, merged, skipped }

// CMS — owner suspends/unsuspends a member (hard account block). Auth-gated.
router.post('/:id/suspend', requireCmsAuth, setSuspended);

module.exports = router;
