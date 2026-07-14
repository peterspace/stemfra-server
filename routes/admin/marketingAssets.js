const express = require('express');
const router = express.Router();
const { requireStaffRole, PLATFORM_OPS } = require('../../middleware/staffAuth');
const { listMarketingAssets, uploadMarketingAsset, updateMarketingAsset, deleteMarketingAsset } = require('../../controllers/admin/marketingAssetsController');

// Marketing-site imagery slots (the CRM "Site imagery" tab) — see the
// marketing_assets table. Replacing a slot's image re-skins stemfra.com live.
router.get('/', requireStaffRole(...PLATFORM_OPS), listMarketingAssets);
router.post('/upload', requireStaffRole(...PLATFORM_OPS), uploadMarketingAsset);
router.patch('/', requireStaffRole(...PLATFORM_OPS), updateMarketingAsset);
router.post('/delete', requireStaffRole(...PLATFORM_OPS), deleteMarketingAsset);

module.exports = router;
