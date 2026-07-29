const express = require('express');
const router = express.Router();
const {
  config, createIntent,
  startCheckout, checkoutReturn, verifyCheckout, startGroupCheckout,
} = require('../controllers/sitePaymentsController');

// Public — called by the customer template sites.
router.get('/config', config);
router.post('/intent', createIntent);            // legacy Connect Element (dormant)

// P12 direct-key hosted Checkout (booking-first).
router.post('/checkout', startCheckout);         // hold booking + Checkout Session → { url }
router.post('/group-checkout', startGroupCheckout); // Task #21: multi-service basket → { url } | booked
router.get('/checkout/return', checkoutReturn);  // Stripe success_url → verify + redirect to site
router.post('/checkout/verify', verifyCheckout); // JSON verify for a client confirmation page

module.exports = router;
