const express = require('express');
const { unsubscribe, resubscribe } = require('../controllers/emailPrefsController');

const router = express.Router();
router.get('/unsubscribe', unsubscribe);
router.get('/resubscribe', resubscribe);

module.exports = router;
