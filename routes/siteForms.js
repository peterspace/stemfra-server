const express = require('express');
const router  = express.Router();
const { submitSiteLead, subscribeNewsletter } = require('../controllers/siteFormController');

// POST /api/site-forms/lead — contact form submission from a customer site
router.post('/lead', submitSiteLead);

// POST /api/site-forms/newsletter — footer newsletter signup
router.post('/newsletter', subscribeNewsletter);

module.exports = router;
