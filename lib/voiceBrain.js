// Voice brain for Stemfra Voice (Agent 3) — the LLM that runs the phone conversation.
// Runs DIRECTLY in the server (NOT n8n — n8n is too slow for live audio). Reuses the
// Concierge knowledge (buildConciergeContext) with a SPOKEN persona. Designed to serve
// both inbound (caller unknown) and later outbound (a `leadContext` describing who/why
// we're calling), so the outbound fast-follow reuses this unchanged.
const OpenAI = require('openai');
const { buildVoiceKnowledge } = require('./conciergeContext');

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const VOICE_MODEL = process.env.VOICE_MODEL || 'gpt-4o';

function isConfigured() { return !!openai; }

// Prime the OpenAI TLS connection + model path so the FIRST real reply isn't slowed
// by cold-start (~several seconds of connection warmup). Fire-and-forget on call
// setup, while Twilio is still speaking the welcomeGreeting — by the time the caller
// finishes their first sentence, the connection is hot. Errors are ignored.
function warmup() {
  if (!openai) return;
  openai.chat.completions
    .create({ model: VOICE_MODEL, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] })
    .catch(() => {});
}

function buildSystemPrompt({ leadContext } = {}) {
  return [
    'You are Mark, the receptionist for Stemfra, talking with a caller on the PHONE.',
    'You introduce yourself as "Mark with Stemfra." If a caller directly asks whether you are a bot or AI, say so plainly and warmly — never pretend to be human when asked.',
    'CRITICAL — talk like a real receptionist: keep EVERY reply to ONE short sentence (two at the very most), then a short follow-up question. LEAD with the exact fact they asked for — e.g. for a plan, give its PRICE and its one-line benefit ("Growth is $199 a month and adds a 24/7 AI receptionist"). Don\'t read out every feature or all three plans at once. Your words are read aloud by text-to-speech, so no URLs, no markdown, no spelling things out. Stemfra has no "free trial" — you "start free" to preview your site before paying.',
    'Sound human: open replies with a gentle, natural acknowledgement now and then ("Sure," "Got it," "Of course," "Happy to help") — but vary it and don\'t overuse it. NEVER use call-center clichés like "That\'s a great question" or "I appreciate your patience."',
    'Answer questions about Stemfra ONLY from the KNOWLEDGE below — never invent prices, plans or features. If you are unsure, say a teammate will follow up.',
    'Help the caller; when they are interested, either point them to start free at stemfra dot com OR take their details so a teammate follows up.',
    'COLLECTING CONTACT DETAILS — do this ONE STEP AT A TIME and CONFIRM each before moving on. Never skip a step, never rush, never claim you saved something you did not actually get:',
    '  1) Ask their name.',
    '  2) Ask their email. Then READ IT BACK to confirm the spelling, slowly and clearly, like: "let me make sure I have that right — j, o, h, n, at gmail dot com — is that correct?" If they say it is wrong, ask them to repeat and read it back again until they confirm.',
    '  3) Ask whether they want the follow-up on the number they are calling from, or a different number. If a different number, ask for the WHOLE number at once (never in three- or four-digit pieces), then read it back one time, digit by digit, to confirm.',
    'Only AFTER the email (and the callback number) are confirmed should you wrap up. If you have not gotten the email yet, do not say goodbye — ask for it.',
    'If the caller wants to stop or opt out, acknowledge warmly and end the call politely.',
    leadContext ? `CONTEXT FOR THIS CALL: ${leadContext}` : '',
    '',
    buildVoiceKnowledge(),
  ].filter(Boolean).join('\n');
}

// Stream the assistant's spoken reply. Calls onToken(textChunk) as tokens arrive
// (so ConversationRelay can speak incrementally → low latency). Returns the full text.
// `signal` (AbortSignal) lets the caller cut the reply off on barge-in.
async function streamReply({ history, leadContext, onToken, signal }) {
  if (!openai) { const m = "Sorry, I can't take this call right now."; onToken(m); return m; }
  const messages = [{ role: 'system', content: buildSystemPrompt({ leadContext }) }, ...history];
  let full = '';
  try {
    const stream = await openai.chat.completions.create(
      { model: VOICE_MODEL, messages, stream: true, temperature: 0.6, max_tokens: 90 },
      { signal },
    );
    for await (const chunk of stream) {
      const t = chunk.choices?.[0]?.delta?.content || '';
      if (t) { full += t; onToken(t); }
    }
  } catch (e) {
    if (e?.name === 'AbortError') return full; // barge-in — keep what we said
    console.error('[voiceBrain] streamReply error:', e.message);
    if (!full) { const m = 'Sorry, could you say that again?'; onToken(m); return m; }
  }
  return full;
}

// Best-effort: distill the call into a CRM lead at hang-up. Returns
// { name, email, vertical, summary, wants_followup } | null.
async function extractLead({ history }) {
  if (!openai || !history.length) return null;
  try {
    const r = await openai.chat.completions.create({
      model: VOICE_MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Extract a CRM lead from this phone call as JSON: {"name":string|null,"email":string|null,"phone":string|null,"vertical":string|null,"summary":string|null,"wants_followup":boolean}. Rules: use ONLY facts the CALLER stated (ignore the assistant\'s words). "email" is the caller\'s confirmed email. "phone" is ONLY a callback number the caller explicitly gave that differs from their caller ID — else null. "summary" is one short line about what the CALLER wants (e.g. "Interested in the Growth plan for a CrossFit gym") — NOT a quote of the assistant. JSON only.' },
        { role: 'user', content: history.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n') },
      ],
    });
    return JSON.parse(r.choices[0].message.content);
  } catch (e) {
    console.error('[voiceBrain] extractLead error:', e.message);
    return null;
  }
}

module.exports = { isConfigured, warmup, streamReply, extractLead, VOICE_MODEL };
