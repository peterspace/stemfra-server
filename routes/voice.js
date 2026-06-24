const express = require('express');
const router = express.Router();
const { conciergeIncoming } = require('../controllers/voiceController');

// Stemfra Voice (Agent 3) — Twilio voice webhooks. The real-time audio runs over the
// ConversationRelay WebSocket at /voice/relay (attached in index.js), not here.
// Point a Twilio number's Voice "A Call Comes In" webhook at this endpoint.
router.post('/concierge/incoming', conciergeIncoming);

module.exports = router;
