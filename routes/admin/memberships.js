const express = require('express');
const router = express.Router();
const { requireStaffAuth } = require('../../middleware/staffAuth');
const { listMemberships, cancelMembership, refundMembership } = require('../../controllers/admin/operationsController');

router.get('/', requireStaffAuth, listMemberships);
router.post('/:id/cancel', requireStaffAuth, cancelMembership);
router.post('/:id/refund', requireStaffAuth, refundMembership);

module.exports = router;
