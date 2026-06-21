const express = require('express');
const router = express.Router();
const { createCheckout } = require('../controllers/siteMembershipsController');

// Public — a visitor subscribes to a native membership plan (System B / Connect).
router.post('/checkout', createCheckout);

module.exports = router;
