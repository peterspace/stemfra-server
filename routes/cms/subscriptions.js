const express = require('express');
const router = express.Router();
const { requireCmsAuth } = require('../../middleware/cmsAuth');
const { cancelSubscription, pauseSubscription, resumeSubscription } = require('../../controllers/cms/subscriptionsController');

// CMS — owner manages member subscriptions. Auth-gated; ownership per-request.
router.post('/:id/cancel', requireCmsAuth, cancelSubscription);
router.post('/:id/pause', requireCmsAuth, pauseSubscription);
router.post('/:id/resume', requireCmsAuth, resumeSubscription);

module.exports = router;
