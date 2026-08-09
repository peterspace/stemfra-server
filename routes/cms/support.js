// Owner support tickets + support-call config (P16.3). All owner-auth.
const express = require('express');
const { requireCmsAuth } = require('../../middleware/cmsAuth');
const { createRequest, listRequests, callConfig } = require('../../controllers/cms/supportController');

const router = express.Router();

router.get('/call-config', requireCmsAuth, callConfig);
router.get('/', requireCmsAuth, listRequests);
router.post('/', requireCmsAuth, createRequest);

module.exports = router;
