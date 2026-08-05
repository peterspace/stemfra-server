const express = require('express');
const router = express.Router();
const { createCheckout, signup } = require('../controllers/siteMembershipsController');

// Public — pay-at-venue membership signup (P14, the LIVE path): records a pending
// subscription, owner confirms payment in the CMS.
router.post('/signup', signup);

// Public — LEGACY Stripe Connect checkout. Dormant; kept, not called by new UI.
router.post('/checkout', createCheckout);

module.exports = router;
