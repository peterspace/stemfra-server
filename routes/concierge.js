const express = require('express');
const router = express.Router();
const { send } = require('../controllers/conciergeController');

// Concierge (Agent 1) — PUBLIC, called by the chat widget on Stemfra's marketing
// site (stemfra_client). Stateless: the widget sends recent `history` each turn.
router.post('/send', send); // { message, history? }

module.exports = router;
