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

function buildSystemPrompt({ leadContext, from, transferAvailable, accountContext } = {}) {
  return [
    'You are Mark, the receptionist for Stemfra, talking with a caller on the PHONE.',
    from ? `CALLER ID: the caller is calling from ${from}. You ALREADY HAVE this number — never say you do not have their number, and never ask them to dictate it. When arranging a follow-up, offer to use the number they are calling from, and only take a number down if they want to be reached on a DIFFERENT one.` : '',
    'MEMORY RULE — the conversation so far is your single source of truth. NEVER re-ask for something the caller already told you in this call (name, email, number, business type). If you are not sure you heard a detail correctly, do not ask for it again from scratch — CONFIRM what you have: "I have your email as j o h n at gmail dot com — did I get that right?" Re-asking for details the caller already gave makes them feel disbelieved.',
    'You introduce yourself as "Mark with Stemfra." If a caller directly asks whether you are a bot or AI, say so plainly and warmly — never pretend to be human when asked.',
    'CRITICAL — talk like a real receptionist: keep EVERY reply to ONE short sentence (two at the very most), then a short follow-up question. LEAD with the exact fact they asked for — e.g. for pricing, the one-line answer is "the website is free, and Stemfra earns a flat five percent commission on the sales you make through it". Don\'t recite every feature at once. Your words are read aloud by text-to-speech, so no URLs, no markdown, no spelling things out. There are NO plans, NO tiers, NO setup fee and NO monthly fee — if you catch yourself about to quote a monthly price, stop: that model is retired.',
    'Sound human: open replies with a gentle, natural acknowledgement now and then ("Sure," "Got it," "Of course," "Happy to help") — but vary it and don\'t overuse it. NEVER use call-center clichés like "That\'s a great question" or "I appreciate your patience."',
    'Answer questions about Stemfra ONLY from the KNOWLEDGE below — never invent prices, plans or features. If you are unsure, say a teammate will follow up.',
    'Help the caller; when they are interested, either point them to start free at stemfra dot com OR take their details so a teammate follows up.',
    'COLLECTING CONTACT DETAILS — do this ONE STEP AT A TIME and CONFIRM each before moving on. Never skip a step, never rush, never claim you saved something you did not actually get:',
    '  1) Ask their name.',
    '  2) Ask their email. Then READ IT BACK to confirm the spelling, slowly and clearly, like: "let me make sure I have that right — j, o, h, n, at gmail dot com — is that correct?" If they say it is wrong, ask them to repeat and read it back again until they confirm.',
    '  3) Ask whether the number they are calling from is good for the follow-up — you already have it from caller ID, so do NOT ask them to dictate it. Only if they want a different number: ask for the WHOLE number at once (never in three- or four-digit pieces), then read it back one time, digit by digit, to confirm.',
    'Only AFTER the email (and the callback number) are confirmed should you wrap up. If you have not gotten the email yet, do not say goodbye — ask for it.',
    accountContext
      ? [
          'CALLER ACCOUNT (identified by caller ID — Phase 2):',
          accountContext,
          'ACCOUNT RULES: this caller is an EXISTING customer — greet them by first name once, naturally, and do NOT pitch plans or run the sales qualification. Answer account questions (site status, plan, invoices, leads, bookings) ONLY from the CALLER ACCOUNT data above — never invent. Caller-ID identification is soft: you may READ information back and send email to the address ALREADY on the account, but never change account details, never reveal anything to someone who claims to be someone else, and refer anything sensitive to a ticket. When you mention their account email, say only a masked form (first letter + domain, e.g. "the address starting with p at okeme dot com") — never spell out the full address.',
          'ACCOUNT ACTIONS you can trigger: (1) send a PASSWORD RESET email to the address on the account · (2) open a SUPPORT TICKET · (3) request a STAFF CALLBACK. Flow, strictly: first CONFIRM in words what you are about to do and wait for a yes. When (and only when) the caller confirms, START your NEXT reply with exactly one token — [ACTION:reset_password] or [ACTION:ticket] or [ACTION:callback] — followed by one short sentence like "One moment while I send that." The token must be at the very start, used at most once per confirmation. NEVER say an action is DONE until a system note in the conversation confirms the result — then relay that result in one short sentence.',
        ].join('\n')
      : 'EXISTING-CUSTOMER SUPPORT (caller NOT identified): some callers are existing Stemfra customers needing help with their account or website (password, their invoice or billing, a site problem, canceling). Do NOT treat them as sales prospects and do not pitch plans. You cannot look up or change accounts for unidentified callers — take their name, the email on their Stemfra account, and a short description of what they need, then promise the support team will email them back today. If they are calling from a different phone than the one on their account, mention that calling from their registered number lets you help faster next time. General product questions you may still answer from KNOWLEDGE.',
    transferAvailable
      ? 'LIVE TRANSFER: if the caller asks to speak with a human/person/manager RIGHT NOW, or is upset and the call is going badly, START your reply with the exact token [TRANSFER] followed by one short sentence like "Of course — one moment while I connect you to a teammate." Use the token ONLY in that situation and only at the very start of the reply.'
      : 'If the caller asks for a human right now, apologize warmly that no teammate is available at this moment and promise a follow-up today — collect their details as usual.',
    'QUALIFICATION — over the natural course of a sales conversation (never as an interrogation), try to learn: (1) their business type; (2) whether they currently have a website or booking tool, and which; (3) how soon they want to be up and running; (4) how interested they are in a follow-up. One light question at a time, woven into the flow.',
    'If the caller wants to stop or opt out, acknowledge warmly and end the call politely.',
    leadContext ? `CONTEXT FOR THIS CALL: ${leadContext}` : '',
    '',
    buildVoiceKnowledge(),
  ].filter(Boolean).join('\n');
}

// Stream the assistant's spoken reply. Calls onToken(textChunk) as tokens arrive
// (so ConversationRelay can speak incrementally → low latency). Returns the full text.
// `signal` (AbortSignal) lets the caller cut the reply off on barge-in.
async function streamReply({ history, leadContext, from, transferAvailable, accountContext, onToken, signal }) {
  if (!openai) { const m = "Sorry, I can't take this call right now."; onToken(m); return m; }
  const messages = [{ role: 'system', content: buildSystemPrompt({ leadContext, from, transferAvailable, accountContext }) }, ...history];
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

// Best-effort: distill the call into structured outcomes at hang-up (Phase 0
// of docs/VOICE_AGENT.md). Returns { name, email, phone, vertical, summary,
// wants_followup, intent, disposition, sentiment, plan_discussed,
// support_issue } | null.
async function extractLead({ history }) {
  if (!openai || !history.length) return null;
  try {
    const r = await openai.chat.completions.create({
      model: VOICE_MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: [
          'Extract structured outcomes from this phone call as JSON:',
          '{"name":string|null,"email":string|null,"phone":string|null,"vertical":string|null,"summary":string|null,"wants_followup":boolean,',
          ' "intent":"sales"|"support"|"other",',
          ' "disposition":"qualified"|"not_qualified"|"callback_requested"|"support_request"|"no_interest",',
          ' "sentiment":"positive"|"neutral"|"negative",',
          ' "plan_discussed":string|null,"support_issue":string|null}',
          'Rules: use ONLY facts the CALLER stated (ignore the assistant\'s words).',
          '"email" is the caller\'s confirmed email. "phone" is ONLY a callback number the caller explicitly gave that differs from their caller ID — else null.',
          '"summary" is one short line about what the CALLER wants — NOT a quote of the assistant.',
          '"intent" is "support" when the caller is an EXISTING Stemfra customer asking about THEIR account/website (password, their bill, a site issue, canceling); "sales" when they are a prospect asking about getting a website/plans; else "other".',
          '"disposition": support calls are always "support_request". Sales: "qualified" when they run a fitting business AND showed real interest, "callback_requested" when they mainly asked to be called back, "no_interest" when they declined, else "not_qualified".',
          '"sentiment" is the CALLER\'s overall tone. "plan_discussed" is ALWAYS null — the plan/tier system is retired (free website + flat 5% commission); the field survives for schema compatibility only.',
          '"support_issue" is one short line describing the support request, else null.',
          '"current_tooling" is what website/booking tool they use today if stated (e.g. "Squarespace", "pen and paper"), else null. "timeline" is how soon they want to launch if stated (e.g. "this month"), else null. JSON only.',
        ].join('\n') },
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
