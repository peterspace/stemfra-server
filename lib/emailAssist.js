// emailAssist.js — AI assist for the CRM email composer (2026-08-31, the
// leadgen-CRM composer parity arc): refine chips (Simplify/Shorten/…) +
// "Draft with AI" from a staff instruction. Server-side so the refine
// instruction set stays a WHITELIST, the key stays server-held, and the
// returned HTML is sanitized before the editor ever sees it. OpenAI per
// the 2026-06-26 back-office drafting decision (same key as leadgenDraft
// and businessAssist).
const OpenAI = require('openai');
const sanitizeHtml = require('sanitize-html');

const MODEL = process.env.EMAIL_ASSIST_MODEL || process.env.LEADGEN_MODEL || 'gpt-4o';
const client = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

const REFINE_INSTRUCTIONS = {
  simplify: 'Simplify this email so it is plainer and easier to read, keeping the same meaning.',
  shorten: 'Shorten this email while keeping the key message and every factual detail that matters.',
  lengthen: 'Expand this email with a little more helpful detail, in the same tone.',
  warmer: 'Rewrite this email in a warmer, friendlier tone.',
  professional: 'Rewrite this email in a more polished, professional tone.',
  proofread: 'Fix spelling, grammar, and punctuation only. Do not change tone, structure, or wording beyond corrections.',
};

// Tighter than the composer's own toolbar output on purpose: assist
// responses are prose, so structure + inline marks + links are enough.
const SANITIZE = {
  allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'a', 'ul', 'ol', 'li', 'blockquote'],
  allowedAttributes: { a: ['href'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  disallowedTagsMode: 'discard',
};

const HTML_RULES =
  'Return ONLY the email body as simple HTML using <p>, <br>, <strong>, <em>, <u>, <s>, <a href>, <ul>, <ol>, <li>, <blockquote>. '
  + 'No markdown, no code fences, no subject line, no commentary. Never invent facts, prices, dates, or contact details. '
  + 'Never use em-dashes anywhere; use a comma, colon, or period instead. '
  + 'If the message ends with a signature block (name, company, phone, links), keep that block VERBATIM.';

function clean(raw) {
  const out = String(raw || '').trim().replace(/^```(?:html)?\s*|\s*```$/g, '');
  return sanitizeHtml(out, SANITIZE).trim() || null;
}

async function refineEmailHtml(html, instructionKey) {
  const instruction = REFINE_INSTRUCTIONS[instructionKey];
  if (!instruction) return { error: 'Unknown refine instruction.' };
  if (!client) return { error: 'AI assist needs an OpenAI key on the server.' };
  const input = String(html || '').slice(0, 20000);
  if (!input.trim()) return { error: 'Nothing to refine.' };
  try {
    const r = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: `You edit business emails for Stemfra staff. Rewrite the email body below per the instruction. ${HTML_RULES}` },
        { role: 'user', content: `Instruction: ${instruction}\n\nEmail body (HTML):\n${input}` },
      ],
      max_tokens: 1200,
    });
    const out = clean(r.choices[0].message.content);
    if (!out) return { error: 'The refine came back empty. Try again.' };
    return { html: out, model: MODEL };
  } catch (e) {
    console.warn('[email-assist] refine failed:', e.message);
    return { error: `Refine failed: ${e.message}` };
  }
}

// Draft from a staff instruction ("follow up with Sarah about the unpaid
// July invoice, friendly"). context carries what the composer knows:
// recipient, current subject, the thread being replied to.
async function draftEmail({ instruction, to, subject, context }) {
  if (!client) return { error: 'AI assist needs an OpenAI key on the server.' };
  const brief = String(instruction || '').trim().slice(0, 2000);
  if (!brief) return { error: 'Tell the assistant what the email should say.' };
  try {
    const r = await client.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: 'system',
          content: 'You draft business emails for staff at Stemfra, a website + growth platform for local businesses. '
            + 'Write naturally and concretely, no filler, no hype. Where a fact is unknown, leave a [bracketed placeholder] rather than inventing it. '
            + `Respond as JSON: {"subject": "...", "body": "..."} where body follows these rules: ${HTML_RULES}`,
        },
        {
          role: 'user',
          content: [
            `Draft an email. Instruction: ${brief}`,
            to ? `Recipient: ${String(to).slice(0, 200)}` : null,
            subject ? `Current subject (keep unless the instruction says otherwise): ${String(subject).slice(0, 200)}` : null,
            context ? `Context:\n${String(context).slice(0, 6000)}` : null,
          ].filter(Boolean).join('\n\n'),
        },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 1200,
    });
    const parsed = JSON.parse(r.choices[0].message.content);
    const body = clean(parsed.body);
    if (!body) return { error: 'The draft came back empty. Try again.' };
    return { subject: String(parsed.subject || subject || '').slice(0, 300), html: body, model: MODEL };
  } catch (e) {
    console.warn('[email-assist] draft failed:', e.message);
    return { error: `Draft failed: ${e.message}` };
  }
}

module.exports = { refineEmailHtml, draftEmail, REFINE_INSTRUCTIONS };
