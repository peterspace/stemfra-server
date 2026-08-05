const express = require('express');
const router = express.Router();
const { requireCmsAuth } = require('../../middleware/cmsAuth');
const { activateSubscription, declineSubscription, confirmPayments, cancelSubscription, pauseSubscription, resumeSubscription } = require('../../controllers/cms/subscriptionsController');

// CMS — owner manages member subscriptions. Auth-gated; ownership per-request.
// Confirm-all collected renewals (body carries siteId; ownership checked there).
// Mounted before '/:id/*' so 'confirm-payments' is never read as an :id.
router.post('/confirm-payments', requireCmsAuth, confirmPayments);
// Pay-at-venue lifecycle:
router.post('/:id/activate', requireCmsAuth, activateSubscription);
router.post('/:id/decline', requireCmsAuth, declineSubscription);
router.post('/:id/cancel', requireCmsAuth, cancelSubscription);
router.post('/:id/pause', requireCmsAuth, pauseSubscription);
router.post('/:id/resume', requireCmsAuth, resumeSubscription);

module.exports = router;
