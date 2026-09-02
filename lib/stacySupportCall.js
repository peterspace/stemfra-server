// stacySupportCall.js — Stacy book-a-call INTENT detection (2026-09-02).
// Rewritten the same day it was built: the first version ran a chip/state
// LLM dialogue for days and times; Peter pointed at the CONCIERGE widget
// (stemfra_client ConciergeChat.jsx), whose reviewed UX never does that —
// the agent says one line and a structured BookingPanel takes over. Stacy
// now mirrors it: this lib only decides WHETHER the owner is asking to book
// a call with Stemfra; the Stacy panel renders the picker (the Support
// page's calendar flow) and books through the public engine.
function detectBookCallIntent(message) {
  const msg = String(message || '');
  return /\b(book|schedule|set ?up|arrange)\b[\s\S]{0,60}\b(call|meeting|consultation)\b/i.test(msg);
}

module.exports = { detectBookCallIntent };
