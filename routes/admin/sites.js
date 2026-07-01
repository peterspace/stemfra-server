const express = require('express');
const router = express.Router();
const { requireStaffRole, PLATFORM_OPS } = require('../../middleware/staffAuth');
const { listSites, provision, cloneAdmin, attach, detach, publish, unpublish, readiness, setCustomDomain, removeCustomDomain, deleteSite, restore } = require('../../controllers/admin/sitesController');

const gate = requireStaffRole(...PLATFORM_OPS);

router.get('/', gate, listSites);
router.post('/provision', gate, provision);
router.post('/:siteId/clone', gate, cloneAdmin);
router.get('/:siteId/readiness', gate, readiness);
router.post('/:siteId/attach', gate, attach);
router.post('/:siteId/detach', gate, detach);
router.post('/:siteId/publish', gate, publish);
router.post('/:siteId/unpublish', gate, unpublish);
router.post('/:siteId/custom-domain', gate, setCustomDomain);
router.delete('/:siteId/custom-domain', gate, removeCustomDomain);
router.post('/:siteId/delete', gate, deleteSite);
router.post('/:siteId/restore', gate, restore);

module.exports = router;
