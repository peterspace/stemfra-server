// Lead-gen outreach draft refinement — the GPT-backed "copilot" behind the CRM
// Review Queue's refine actions. A reviewer tweaks the AI-drafted outreach with
// a preset (Shorten / Warmer / …) or a free-text instruction; this revises it,
// grounded in the lead's own qualification context so personalization stays real.
//
// Runs DIRECTLY in the server (synchronous, interactive — no n8n round-trip) and
// uses GPT: per the 2026-06-26 decision the lead-gen / back-office drafting side
// standardizes on OpenAI (the customer-facing AGENTS stay multi-model). Reuses
// the same OPENAI_API_KEY as the voice brain.
const OpenAI = require('openai');

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const LEADGEN_MODEL = process.env.LEADGEN_MODEL || 'gpt-4o';

function isConfigured() { return !!openai; }

// Revise an outreach draft per an instruction. Returns { subject, message }.
// `subject` is null for non-email channels.
async function refineDraft({ channel, subject, message, instruction, lead = {}, senderName = '' }) {
  if (!openai) throw new Error('OPENAI_API_KEY not configured');
  const isEmail = (channel || '').toLowerCase() === 'email';
  const q = lead.qualification || {};
  const weakWeb = q.trait_weak_web ?? q.weak_web ?? null;

  const context = [
    lead.company_name && `Business: ${lead.company_name}`,
    lead.contact_name && `Contact: ${lead.contact_name}`,
    lead.vertical && `Vertical: ${String(lead.vertical).replace(/_/g, ' ')}`,
    lead.region && `Location: ${lead.region}`,
    lead.pain_point_bucket && `Pain point: ${lead.pain_point_bucket}`,
    q.reasoning && `Why a fit: ${q.reasoning}`,
    q.buying_trigger && String(q.buying_trigger).toLowerCase() !== 'none' && `Buying trigger: ${q.buying_trigger}`,
    weakWeb != null && `Weak-web score: ${weakWeb}/10`,
  ].filter(Boolean).join('\n');

  const sys = [
    'You are an expert B2B outreach copywriter for Stemfra — a done-for-you website, online-booking and payments platform for local service businesses (barbershops, salons, gyms, yoga/pilates studios).',
    `You are revising an outreach ${isEmail ? 'EMAIL' : 'message'} to a prospect. Apply the reviewer\'s instruction faithfully.`,
    'Rules: keep it concise and human; exactly ONE clear, soft call-to-action; never spammy or hype-y; personalize ONLY from the provided lead context and NEVER invent facts.',
    'NEVER output bracketed placeholders of ANY kind ([Name], [Company], [Your Name], etc.). Use the real values given, or phrase naturally without them.',
    senderName
      ? `Sign off from the sender, ${senderName} (at Stemfra). End with a short sign-off and that name.`
      : 'Do NOT add a signature line — end right after the call-to-action (the sender appends their own signature). Never write a bracketed name placeholder.',
    isEmail
      ? 'Return ONLY JSON: {"subject": string, "message": string}. Keep the subject under ~60 characters — specific, not clickbait.'
      : 'Return ONLY JSON: {"message": string}. There is no subject (this is not an email).',
  ].join('\n');

  const usr = [
    'LEAD CONTEXT:', context || '(minimal context available)',
    '',
    isEmail && subject ? `CURRENT SUBJECT:\n${subject}\n` : '',
    `CURRENT MESSAGE:\n${message || '(empty)'}`,
    '',
    `INSTRUCTION: ${instruction || 'Improve and tighten this outreach.'}`,
  ].filter(Boolean).join('\n');

  const r = await openai.chat.completions.create({
    model: LEADGEN_MODEL,
    temperature: 0.7,
    response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: sys }, { role: 'user', content: usr }],
  });
  const out = JSON.parse(r.choices[0].message.content || '{}');
  return {
    subject: isEmail ? (out.subject ?? subject ?? null) : null,
    message: out.message ?? message ?? '',
  };
}

// Refine a REUSABLE email template (keeps {{merge_fields}} intact, stays generic,
// self-serve CTA). Returns { subject, body }.
async function refineTemplate({ subject, body, instruction }) {
  if (!openai) throw new Error('OPENAI_API_KEY not configured');
  const sys = [
    'You are an expert B2B email copywriter editing a REUSABLE EMAIL TEMPLATE for Stemfra — a done-for-you website, online-booking and payments platform for local service businesses (barbershops, salons, gyms, yoga/pilates).',
    'The template uses handlebars merge fields like {{first_name}}, {{business_name}}, {{vertical}}, {{city}}, {{demo_link}}, {{start_free_link}}, {{setup_fee}}, {{monthly_price}}, {{sender_name}}, {{sender_phone}}, {{sender_email}}.',
    'CRITICAL: PRESERVE every {{merge_field}} exactly — never remove, rename, or fill them in. This is a TEMPLATE, not a personalized email; keep it generic with the fields intact.',
    'Stemfra is SELF-SERVE first: the call-to-action drives the reader to see a live demo and start free on the pricing tiers — NOT to book a sales/discovery call. Do not reintroduce "book a call" CTAs.',
    'Apply the editor instruction. Return ONLY JSON: {"subject": string, "body": string}.',
  ].join('\n');
  const usr = `CURRENT SUBJECT:\n${subject || ''}\n\nCURRENT BODY:\n${body || ''}\n\nINSTRUCTION: ${instruction}`;
  const r = await openai.chat.completions.create({
    model: LEADGEN_MODEL, temperature: 0.6, response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: sys }, { role: 'user', content: usr }],
  });
  const out = JSON.parse(r.choices[0].message.content || '{}');
  return { subject: out.subject ?? subject, body: out.body ?? body };
}

module.exports = { isConfigured, refineDraft, refineTemplate, LEADGEN_MODEL };
