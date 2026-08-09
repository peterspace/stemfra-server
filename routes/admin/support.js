// Staff support endpoints (P16.3b) — PLATFORM_OPS (support role included).
const express = require('express');
const { requireStaffRole, PLATFORM_OPS } = require('../../middleware/staffAuth');
const { listRequests, updateStatus, callConfig } = require('../../controllers/admin/supportController');

const router = express.Router();

router.get('/call-config', requireStaffRole(...PLATFORM_OPS), callConfig);
router.get('/', requireStaffRole(...PLATFORM_OPS), listRequests);
router.patch('/:id', requireStaffRole(...PLATFORM_OPS), updateStatus);

module.exports = router;
