const express = require('express');
const router = express.Router();
const { conciergeIncoming, handleHandoff, handleAmd, handleOutboundStatus } = require('../controllers/voiceController');

// Stemfra Voice (Agent 3) — Twilio voice webhooks. The real-time audio runs over the
// ConversationRelay WebSocket at /voice/relay (attached in index.js), not here.
// Point a Twilio number's Voice "A Call Comes In" webhook at this endpoint.
router.post('/concierge/incoming', conciergeIncoming);

// Phase 1 (docs/VOICE_AGENT.md) — Twilio callbacks:
//   /handoff          <Connect action> — live transfer to staff, or clean hangup
//   /amd              async answering-machine detection → voicemail drop
//   /outbound-status  final outbound status → missed-call SMS follow-up
router.post('/handoff', handleHandoff);
router.post('/amd', handleAmd);
router.post('/outbound-status', handleOutboundStatus);

module.exports = router;
