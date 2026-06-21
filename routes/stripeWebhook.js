const express = require('express');
const router = express.Router();
const { handleWebhook } = require('../controllers/stripeWebhookController');

// The raw body parser (express.raw) is applied at mount time in index.js,
// because Stripe signature verification needs the unparsed request body.
router.post('/', handleWebhook);

module.exports = router;
