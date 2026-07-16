// Business-plan / pitch-deck drafting copilot for the stemfra_business app.
// Runs DIRECTLY in the server (synchronous, interactive — no n8n round-trip)
// and uses GPT, consistent with the 2026-06-26 decision that the back-office
// drafting side standardizes on OpenAI (customer-facing AGENTS stay
// multi-model). Reuses the same OPENAI_API_KEY as leadgenDraft / voiceBrain.
const OpenAI = require('openai');

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const BUSINESS_MODEL = process.env.BUSINESS_MODEL || process.env.LEADGEN_MODEL || 'gpt-4o';

function isConfigured() { return !!openai; }

// The block JSON shapes the app understands (mirrors stemfra_business
// src/types/blocks.ts). The model returns ONE block's CONTENT fields; the
// client re-attaches id/visible/type. `live-metric` is intentionally excluded
// — the AI must never fabricate a live number.
const BLOCK_SHAPES = `
- heading:   { "type": "heading",   "kicker"?: string, "title": string, "subtitle"?: string }
- paragraph: { "type": "paragraph", "heading"?: string, "text": string }
- bullets:   { "type": "bullets",   "heading"?: string, "items": string[] }
- stat-grid: { "type": "stat-grid", "heading"?: string, "stats": [{ "label": string, "value": string }] }
- table:     { "type": "table",     "heading"?: string, "columns": string[], "rows": string[][] }
- quote:     { "type": "quote",     "text": string, "attribution"?: string }
- two-col:   { "type": "two-col",   "heading"?: string, "items": [{ "label": string, "value": string }] }
- divider:   { "type": "divider",   "label"?: string }
`.trim();

const SYSTEM = [
  'You are an expert startup-pitch and business-plan writer helping draft and edit an investor-facing document for STEMfra.',
  'STEMfra is a done-for-you website + online-booking + payments platform for US local service businesses (barbershops, salons, CrossFit boxes, yoga/pilates studios, massage studios, day spas), with an AI front-desk/receptionist layer. Pricing: Essential $99/mo, Growth $199/mo, Pro $399/mo, + $1,000 one-time setup. It is PRE-REVENUE with no paying customers yet — never claim traction, revenue, or customers that do not exist. Illustrative projections must be labeled as such.',
  'The document is built from typed content BLOCKS. You edit or draft exactly ONE block at a time.',
  'Block content shapes:',
  BLOCK_SHAPES,
  'Return ONLY a JSON object of the form { "block": <one block content object> } using the exact shape for the requested/edited type. Preserve the block "type". Do not invent statistics; if a number is not given to you, keep it qualitative or reuse what the document already states. Keep the editorial, confident-but-honest register.',
].join('\n');

/**
 * Draft a NEW block or EDIT an existing one.
 * @param {'draft'|'edit'} mode
 * @param {object} opts
 *   - instruction: string (what the user wants)
 *   - context: string (compact summary of the whole document, for grounding)
 *   - blockType: string (draft mode — which shape to produce)
 *   - block: object (edit mode — the current block content to revise)
 * @returns {Promise<object>} the block content object (no id/visible; caller attaches those)
 */
async function assist(mode, { instruction, context = '', blockType, block } = {}) {
  if (!openai) throw new Error('OPENAI_API_KEY not configured');
  if (!instruction || typeof instruction !== 'string') throw new Error('instruction is required');

  const usr = mode === 'edit'
    ? [
        'DOCUMENT CONTEXT (for grounding — do not restate wholesale):', context || '(none)', '',
        'CURRENT BLOCK (JSON):', JSON.stringify(block ?? {}, null, 2), '',
        `INSTRUCTION: ${instruction}`,
        'Return the SAME block type, edited per the instruction.',
      ].join('\n')
    : [
        'DOCUMENT CONTEXT (for grounding — do not restate wholesale):', context || '(none)', '',
        `Draft a NEW block of type "${blockType}".`,
        `INSTRUCTION: ${instruction}`,
      ].join('\n');

  const r = await openai.chat.completions.create({
    model: BUSINESS_MODEL,
    temperature: 0.6,
    response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: usr }],
  });
  const out = JSON.parse(r.choices[0].message.content || '{}');
  const result = out.block ?? out; // tolerate the model returning the block directly
  if (!result || typeof result !== 'object') throw new Error('Model returned no block');
  return result;
}

module.exports = { isConfigured, assist, BUSINESS_MODEL };
