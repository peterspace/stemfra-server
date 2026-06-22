const express = require('express');
const router = express.Router();
const { requireStaffRole, PLATFORM_OPS } = require('../../middleware/staffAuth');
const { listMemberships, cancelMembership, refundMembership } = require('../../controllers/admin/operationsController');

const gate = requireStaffRole(...PLATFORM_OPS);

router.get('/', gate, listMemberships);
router.post('/:id/cancel', gate, cancelMembership);
router.post('/:id/refund', gate, refundMembership);

module.exports = router;
