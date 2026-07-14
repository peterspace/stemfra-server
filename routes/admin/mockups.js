const express = require('express');
const router = express.Router();
const { requireStaffRole, PLATFORM_OPS } = require('../../middleware/staffAuth');
const { capture, listAssets, uploadAsset, deleteAsset, screenshotDemo, preparePage, listMasters, cropMaster, listSaved, saveMockup, deleteSaved, setFeaturedDemo } = require('../../controllers/admin/mockupsController');

// POST /api/admin/mockups/capture — render + screenshot a mockup config → Cloudinary.
router.post('/capture', requireStaffRole(...PLATFORM_OPS), capture);

// Brand-asset library (card sources) — stemfra_assets/mockups/sources.
router.get('/assets', requireStaffRole(...PLATFORM_OPS), listAssets);
router.post('/upload', requireStaffRole(...PLATFORM_OPS), uploadAsset);
router.post('/assets/delete', requireStaffRole(...PLATFORM_OPS), deleteAsset);

// POST /api/admin/mockups/screenshot-demo — screenshot a demo page's fold → sources.
router.post('/screenshot-demo', requireStaffRole(...PLATFORM_OPS), screenshotDemo);

// Prepared masters — demo pages stored as reusable 4× tiles (crop without re-rendering).
router.post('/prepare-page', requireStaffRole(...PLATFORM_OPS), preparePage);
router.get('/masters', requireStaffRole(...PLATFORM_OPS), listMasters);
router.post('/crop-master', requireStaffRole(...PLATFORM_OPS), cropMaster);

// Saved mockups — persisted on the demo site's metadata.marketing_mockups.
router.get('/saved', requireStaffRole(...PLATFORM_OPS), listSaved);
router.post('/save', requireStaffRole(...PLATFORM_OPS), saveMockup);
router.post('/delete-saved', requireStaffRole(...PLATFORM_OPS), deleteSaved);

// POST /api/admin/mockups/featured — flag ONE demo per vertical as Featured
// (exclusive; drives the marketing showcase surfaces via /api/starters).
router.post('/featured', requireStaffRole(...PLATFORM_OPS), setFeaturedDemo);

module.exports = router;
