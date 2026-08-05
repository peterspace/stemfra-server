const express = require('express');
const router = express.Router();
const { requireCmsAuth } = require('../../middleware/cmsAuth');
const { activateSubscription, declineSubscription, cancelSubscription, pauseSubscription, resumeSubscription } = require('../../controllers/cms/subscriptionsController');

// CMS — owner manages member subscriptions. Auth-gated; ownership per-request.
// Pay-at-venue lifecycle:
router.post('/:id/activate', requireCmsAuth, activateSubscription);
router.post('/:id/decline', requireCmsAuth, declineSubscription);
router.post('/:id/cancel', requireCmsAuth, cancelSubscription);
router.post('/:id/pause', requireCmsAuth, pauseSubscription);
router.post('/:id/resume', requireCmsAuth, resumeSubscription);

module.exports = router;
