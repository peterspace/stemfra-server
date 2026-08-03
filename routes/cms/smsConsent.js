const express = require('express');
const { requireCmsAuth } = require('../../middleware/cmsAuth');
const { optIn, optOut } = require('../../controllers/cms/smsConsentController');

const router = express.Router();

// Owner SMS opt-in for A2P 10DLC. Consent is server-recorded and the
// confirmation SMS is server-sent — see the controller for why.
router.post('/', requireCmsAuth, optIn);
router.delete('/', requireCmsAuth, optOut);

module.exports = router;
