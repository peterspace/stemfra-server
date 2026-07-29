const express = require('express');
const router = express.Router();
const { config, month, availability, book } = require('../controllers/setupCallController');

// Public — the marketing site's "Book a setup call" flow.
router.get('/config', config);
router.get('/month', month);
router.get('/availability', availability);
router.post('/book', book);

module.exports = router;
