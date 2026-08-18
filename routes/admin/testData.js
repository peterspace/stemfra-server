// Test-data isolation (launch task #9): staff preview + purge of test data.
//   POST /api/admin/test-data/cleanup { apply?: boolean }  (PLATFORM_ADMIN)
// Dry run unless apply:true. See lib/testDataCleanup.js for the exact scope.
const express = require('express');
const { requireStaffRole, PLATFORM_ADMIN } = require('../../middleware/staffAuth');
const { cleanupTestData } = require('../../lib/testDataCleanup');
const router = express.Router();
const gate = requireStaffRole(...PLATFORM_ADMIN);

router.post('/cleanup', gate, async (req, res) => {
  try {
    const out = await cleanupTestData({ apply: req.body?.apply === true, actorName: req.staffUser?.email || 'staff' });
    res.json({ ok: true, ...out });
  } catch (err) {
    console.error('[test-data] cleanup failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
