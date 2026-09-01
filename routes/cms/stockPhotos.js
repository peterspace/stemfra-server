const express = require('express');
const router = express.Router();
const { requireCmsAuth } = require('../../middleware/cmsAuth');
const { healthcheck, search, importPhoto } = require('../../controllers/cms/stockPhotosController');

// Public — the CMS uses it to decide whether to show the Stock photos tab.
router.get('/healthcheck', healthcheck);

// Auth-gated
router.get('/search', requireCmsAuth, search);        // ?siteId=&q=&page=
router.post('/import', requireCmsAuth, importPhoto);  // { siteId, photoId }

module.exports = router;
