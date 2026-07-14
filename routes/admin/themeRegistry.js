const express = require('express');
const router = express.Router();
const { requireStaffRole, PLATFORM_OPS } = require('../../middleware/staffAuth');
const { getThemeRegistry } = require('../../controllers/admin/themeRegistryController');

// Theme-component registry (Case 6 R1) — powers the CRM Marketing → Components browser.
router.get('/', requireStaffRole(...PLATFORM_OPS), getThemeRegistry);

module.exports = router;
