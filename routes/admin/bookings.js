const express = require('express');
const router = express.Router();
const { requireStaffRole, PLATFORM_OPS } = require('../../middleware/staffAuth');
const { listBookings, refundBooking } = require('../../controllers/admin/operationsController');

const gate = requireStaffRole(...PLATFORM_OPS);

router.get('/', gate, listBookings);
router.post('/:id/refund', gate, refundBooking);

module.exports = router;
