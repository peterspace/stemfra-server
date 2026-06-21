const express = require('express');
const router = express.Router();
const { requireCmsAuth } = require('../../middleware/cmsAuth');
const { healthcheck, uploadImage, deleteMedia, listMedia } = require('../../controllers/cms/uploadController');

// Public — used by deploy verification + uptime monitors
router.get('/healthcheck', healthcheck);

// Auth-gated
router.get('/', requireCmsAuth, listMedia);          // Media library list (?siteId=)
router.post('/upload', requireCmsAuth, uploadImage);
router.delete('/:mediaId', requireCmsAuth, deleteMedia);

module.exports = router;
