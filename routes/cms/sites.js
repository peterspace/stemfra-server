const express = require('express');
const router = express.Router();
const { requireCmsAuth } = require('../../middleware/cmsAuth');
const { createSite } = require('../../controllers/cms/sitesController');

// Owner self-serve "+ New site" — provision an additional site for the
// authenticated owner.
router.post('/', requireCmsAuth, createSite);

module.exports = router;
