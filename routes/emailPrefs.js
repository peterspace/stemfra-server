const express = require('express');
const { unsubscribe, resubscribe, smsOptIn } = require('../controllers/emailPrefsController');

const router = express.Router();
router.get('/unsubscribe', unsubscribe);
router.get('/resubscribe', resubscribe);
router.get('/sms-optin', smsOptIn);

module.exports = router;
