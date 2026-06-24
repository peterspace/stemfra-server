const express = require('express');
const router = express.Router();
const { send, completeBooking } = require('../controllers/siteChatController');

// Front Desk (Agent 2) — PUBLIC, called by the chat widget on a client's template
// site. No owner auth; the tenant is the siteId in the body, validated server-side
// (must be live/previewing + front-desk-enabled). Rate-limited in the controller.
router.post('/send', send); // { siteId, conversationId?, message }
router.post('/complete-booking', completeBooking); // P3: finalize a paid in-chat booking

module.exports = router;
