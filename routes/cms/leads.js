const express = require('express');
const router = express.Router();
const { requireCmsAuth } = require('../../middleware/cmsAuth');
const { replyToLead } = require('../../controllers/cms/leadsController');

// Owner replies to a lead by real email (CMS Leads message view composer).
router.post('/:id/reply', requireCmsAuth, replyToLead);

module.exports = router;
