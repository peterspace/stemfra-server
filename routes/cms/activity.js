const express = require('express');
const router = express.Router();
const { requireCmsAuth } = require('../../middleware/cmsAuth');
const { listActivity } = require('../../controllers/cms/activityController');

// CMS — recent site activity (money-action audit). Auth-gated.
router.get('/', requireCmsAuth, listActivity);

module.exports = router;
