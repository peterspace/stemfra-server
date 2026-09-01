const express = require('express');
const router = express.Router();
const { requireCmsAuth } = require('../../middleware/cmsAuth');
const { replyToLead, suggestReply, refineReply } = require('../../controllers/cms/leadsController');

// Owner replies to a lead by real email (CMS Leads message view composer).
router.post('/:id/reply', requireCmsAuth, replyToLead);

// AI assist for the composer (inbox-parity arc): suggested reply grounded on
// the enquiry, and the whitelisted refine chips.
router.post('/:id/suggest', requireCmsAuth, suggestReply);
router.post('/refine', requireCmsAuth, refineReply);

module.exports = router;
