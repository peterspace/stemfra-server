const express = require('express');
const router = express.Router();
const { createCheckout, portalLink } = require('../controllers/platformBillingController');

// System A — Stemfra bills its business customers (build fee + monthly).
// Staff-only (guarded in the controller). See controllers/platformBillingController.js.
router.post('/checkout', createCheckout);
router.post('/portal', portalLink);

module.exports = router;
