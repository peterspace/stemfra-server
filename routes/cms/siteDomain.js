const express = require('express');
const router = express.Router();
const { requireCmsAuth } = require('../../middleware/cmsAuth');
const { connect, status, disconnect } = require('../../controllers/cms/domainController');

// Owner self-serve brand-domain connect (all gated by CMS owner auth).
router.get('/', requireCmsAuth, status);        // ?siteId= → current connection + CF status
router.post('/', requireCmsAuth, connect);      // { siteId, domain }
router.delete('/', requireCmsAuth, disconnect); // { siteId }

module.exports = router;
