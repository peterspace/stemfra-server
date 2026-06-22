const express = require('express');
const router = express.Router();
const { requireStaffAuth } = require('../../middleware/staffAuth');
const { listBookings, refundBooking } = require('../../controllers/admin/operationsController');

router.get('/', requireStaffAuth, listBookings);
router.post('/:id/refund', requireStaffAuth, refundBooking);

module.exports = router;
