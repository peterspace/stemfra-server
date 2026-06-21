const express = require('express');
const router = express.Router();
const { requireCmsAuth } = require('../../middleware/cmsAuth');
const { setSuspended } = require('../../controllers/cms/customersController');

// CMS — owner suspends/unsuspends a member (hard account block). Auth-gated.
router.post('/:id/suspend', requireCmsAuth, setSuspended);

module.exports = router;
