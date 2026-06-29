// Light keyword classification of an inbound outreach reply (v1). Full LLM intent
// reading is a v1.1 add-on. Order matters: opt-out is checked before "declined".
//   'unsubscribe' → hard opt-out (do_not_email + do_not_call)
//   'declined'    → not interested (stop contacting, not blocked)
//   'interested'  → default → warm queue / staff follow-up / optional call
function classifyReply(text) {
  const t = String(text || '').toLowerCase();
  if (/\b(unsubscribe|opt[\s-]?out|remove me|take me off|stop (e-?mail|contact|messag)|do ?n[o']?t (e-?mail|contact|message))\b/.test(t)) return 'unsubscribe';
  if (/\b(not interested|no thanks?|no thank you|we'?re good|we are good|all set|no need|not (right now|at this time)|please pass|we'?ll pass)\b/.test(t)) return 'declined';
  return 'interested';
}

module.exports = { classifyReply };
