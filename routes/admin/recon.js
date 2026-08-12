// Recon R3 admin routes — PLATFORM_ADMIN, same gate as billing.
const express = require('express');
const { requireStaffRole, PLATFORM_ADMIN } = require('../../middleware/staffAuth');
const {
  listDeposits, resolveDeposit, ignoreDeposit, getSettings, saveSettings, runSweep, requestReceipt,
} = require('../../controllers/admin/reconController');

const router = express.Router();
const gate = requireStaffRole(...PLATFORM_ADMIN);

router.get('/deposits', gate, listDeposits);
router.post('/deposits/:id/resolve', gate, resolveDeposit);
router.post('/deposits/:id/ignore', gate, ignoreDeposit);
router.get('/settings', gate, getSettings);
router.post('/settings', gate, saveSettings);
router.post('/sweep', gate, runSweep);
router.post('/charges/:chargeId/request-receipt', gate, requestReceipt);

module.exports = router;
