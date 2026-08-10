// Compliance Engine routes — staff-gated (PLATFORM_ADMIN, same as billing).
// Read rollups over billing_charges/expenses + CRUD over the compliance tables.
// See stemfra_server/docs/COMPLIANCE_ENGINE.md.
const express = require('express');
const { requireStaffRole, PLATFORM_ADMIN } = require('../../middleware/staffAuth');
const {
  getRegistry, getBooks,
  listRegistrations, createRegistration, updateRegistration, deleteRegistration,
  listFilings, upsertFiling,
  getSettings, putSetting,
} = require('../../controllers/admin/complianceController');

const router = express.Router();
const gate = requireStaffRole(...PLATFORM_ADMIN);

router.get('/registry', gate, getRegistry);
router.get('/books', gate, getBooks);

router.get('/registrations', gate, listRegistrations);
router.post('/registrations', gate, createRegistration);
router.patch('/registrations/:id', gate, updateRegistration);
router.delete('/registrations/:id', gate, deleteRegistration);

router.get('/filings', gate, listFilings);
router.post('/filings', gate, upsertFiling);

router.get('/settings', gate, getSettings);
// POST (not PUT): the global CORS methods list omits PUT, so a PUT is blocked
// after preflight. POST matches the other compliance write endpoints.
router.post('/settings', gate, putSetting);

module.exports = router;
