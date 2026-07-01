const express = require('express');
const router = express.Router();
const { requireCmsAuth } = require('../../middleware/cmsAuth');
const { createSite, cloneOwnSite, deleteOwnSite, restoreOwnSite } = require('../../controllers/cms/sitesController');

// Owner self-serve "+ New site" — provision an additional site for the
// authenticated owner.
router.post('/', requireCmsAuth, createSite);
// Owner self-serve "Clone this shop" — duplicate an owned site (design + catalog
// + content) into a new one.
router.post('/clone', requireCmsAuth, cloneOwnSite);
// Owner self-serve delete / restore (soft-delete, 90-day grace).
router.post('/:siteId/delete', requireCmsAuth, deleteOwnSite);
router.post('/:siteId/restore', requireCmsAuth, restoreOwnSite);

module.exports = router;
