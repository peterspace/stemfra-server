const express = require('express');
const router = express.Router();
const { requireCmsAuth } = require('../../middleware/cmsAuth');
const { listPlans, createPlan, updatePlan, deletePlan } = require('../../controllers/cms/membershipPlansController');

// CMS — native membership plan management (System B). Auth-gated; ownership
// checked per-request in the controller.
router.get('/', requireCmsAuth, listPlans);
router.post('/', requireCmsAuth, createPlan);
router.patch('/:id', requireCmsAuth, updatePlan);
router.delete('/:id', requireCmsAuth, deletePlan);

module.exports = router;
