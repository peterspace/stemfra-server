const express = require('express');
const router = express.Router();
const { requireCmsAuth } = require('../../middleware/cmsAuth');
const { healthcheck, uploadImage, deleteMedia, listMedia, copyMedia } = require('../../controllers/cms/uploadController');

// Public — used by deploy verification + uptime monitors
router.get('/healthcheck', healthcheck);

// Auth-gated
router.get('/', requireCmsAuth, listMedia);          // Media library list (?siteId=)
router.post('/upload', requireCmsAuth, uploadImage);
router.post('/copy', requireCmsAuth, copyMedia);     // cross-site image copy { sourceMediaId, targetSiteId }
router.delete('/:mediaId', requireCmsAuth, deleteMedia);

module.exports = router;
