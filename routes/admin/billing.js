// Admin System-A billing routes — provider-agnostic collection ledger.
// Gated by PLATFORM_ADMIN (super_admin/admin/manager), same as subscriptions.
const express = require('express');
const { requireStaffRole, PLATFORM_ADMIN } = require('../../middleware/staffAuth');
const {
  getProvider, setProvider, listCharges, requestDetails,
  startBilling, openCycle, markRequested, markPaid, getPlans, putPlans,
} = require('../../controllers/admin/billingController');

const router = express.Router();
const gate = requireStaffRole(...PLATFORM_ADMIN);

router.get('/provider', gate, getProvider);
router.post('/provider', gate, setProvider);
router.get('/plans', gate, getPlans);
router.put('/plans', gate, putPlans);
router.get('/charges', gate, listCharges);
router.get('/charges/:id/request-details', gate, requestDetails);
router.post('/charges/:id/requested', gate, markRequested);
router.post('/charges/:id/paid', gate, markPaid);
router.post('/:siteId/start', gate, startBilling);
router.post('/:siteId/open-cycle', gate, openCycle);

module.exports = router;
