const express = require('express');
const router = express.Router();
const { requireCmsAuth } = require('../../middleware/cmsAuth');
const { getReadiness, publish, unpublish } = require('../../controllers/cms/publishController');

// All auth-gated + ownership-checked in the controller.
router.get('/readiness/:siteId', requireCmsAuth, getReadiness);
router.post('/publish', requireCmsAuth, publish);
router.post('/unpublish', requireCmsAuth, unpublish);

module.exports = router;
