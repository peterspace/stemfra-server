// /api/cms/email-connector — the P24 Gmail connector (lead replies send
// as the owner's own Gmail when connected; platform Resend otherwise).
const express = require('express');
const { requireCmsAuth } = require('../../middleware/cmsAuth');
const { status, connect, disconnect } = require('../../controllers/cms/emailConnectorController');

const router = express.Router();
router.get('/', requireCmsAuth, status);
router.post('/', requireCmsAuth, connect);
router.delete('/', requireCmsAuth, disconnect);

module.exports = router;
