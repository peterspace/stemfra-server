const express = require('express');
const router = express.Router();
const { requireStaffAuth } = require('../../middleware/staffAuth');
const { listBookings } = require('../../controllers/admin/operationsController');

router.get('/', requireStaffAuth, listBookings);

module.exports = router;
