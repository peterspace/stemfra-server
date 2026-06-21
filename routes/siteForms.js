const express = require('express');
const router  = express.Router();
const { submitSiteLead } = require('../controllers/siteFormController');

// POST /api/site-forms/lead — contact form submission from a customer site
router.post('/lead', submitSiteLead);

module.exports = router;
