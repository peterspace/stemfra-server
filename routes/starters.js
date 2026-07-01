const express = require('express');
const router = express.Router();
const { list } = require('../controllers/startersController');

// Public — the curated Starter catalog (optionally ?vertical=<slug>).
router.get('/', list);

module.exports = router;
