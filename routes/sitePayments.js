const express = require('express');
const router = express.Router();
const { config, createIntent } = require('../controllers/sitePaymentsController');

// Public — called by the customer template sites.
router.get('/config', config);
router.post('/intent', createIntent);

module.exports = router;
