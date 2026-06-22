const express = require('express');
const router = express.Router();
const { requireStaffAuth } = require('../../middleware/staffAuth');
const { listMemberships } = require('../../controllers/admin/operationsController');

router.get('/', requireStaffAuth, listMemberships);

module.exports = router;
