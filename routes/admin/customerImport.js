// Staff-assisted client import (the CRM side of the import pipeline —
// stemfra_platform/docs/ANALYTICS_AND_IMPORTS_PLAN.md slice 5). Same cores as
// the owner CMS routes; staff can run a migration on any site.
const express = require('express');
const router = express.Router();
const { requireStaffRole, PLATFORM_OPS } = require('../../middleware/staffAuth');
const { adminMapImportColumns, adminImportPreview, adminImportCustomers } = require('../../controllers/cms/customersController');

router.post('/map', requireStaffRole(...PLATFORM_OPS), adminMapImportColumns);       // headers + masked samples → column map
router.post('/preview', requireStaffRole(...PLATFORM_OPS), adminImportPreview);      // dry-run counts
router.post('/', requireStaffRole(...PLATFORM_OPS), adminImportCustomers);           // do the import

module.exports = router;
