const express = require('express');
const router = express.Router();
const { requireStaffAuth } = require('../../middleware/staffAuth');
const { listSites, provision, attach, detach, publish, unpublish, readiness } = require('../../controllers/admin/sitesController');

// All staff-gated (CRM users with an active staff role).
router.get('/', requireStaffAuth, listSites);
router.post('/provision', requireStaffAuth, provision);
router.get('/:siteId/readiness', requireStaffAuth, readiness);
router.post('/:siteId/attach', requireStaffAuth, attach);
router.post('/:siteId/detach', requireStaffAuth, detach);
router.post('/:siteId/publish', requireStaffAuth, publish);
router.post('/:siteId/unpublish', requireStaffAuth, unpublish);

module.exports = router;
