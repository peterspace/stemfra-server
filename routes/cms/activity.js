const express = require('express');
const router = express.Router();
const { requireCmsAuth } = require('../../middleware/cmsAuth');
const { listActivity, recordActivity } = require('../../controllers/cms/activityController');

// CMS — recent site activity (money-action audit). Auth-gated.
router.get('/', requireCmsAuth, listActivity);
// Owner-originated audit events (allowlisted actions; see controller).
router.post('/', requireCmsAuth, recordActivity);

module.exports = router;
