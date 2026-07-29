const express = require('express');
const router = express.Router();
const { requireCmsAuth } = require('../../middleware/cmsAuth');
const { listVariants, preview } = require('../../controllers/cms/emailTemplatesController');

// CMS "Email templates" surface (Case 2, item 3). Owner-auth gated; preview also
// runs verifySiteOwnership per-request against the passed siteId.
router.get('/variants', requireCmsAuth, listVariants);       // pickable variant list
router.get('/preview', requireCmsAuth, preview);             // ?siteId=&variant=&heading=&subheading=&photoUrl= → HTML

module.exports = router;
