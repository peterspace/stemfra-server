// emailHtml.js — sanitize email HTML at INGEST, before it is stored or sent
// (ported from the Helen lead-gen CRM's reference implementation, the standing
// inbox security posture: server-side allowlist, store ONLY sanitized HTML,
// pass our own outbound through the same filter — one trust level; never
// sanitize client-side at render time).
//
// The allowlist covers what mail clients actually emit for formatted text:
// structure, inline marks, lists, quotes, tables, links, and images. Scripts,
// event handlers, forms, iframes, and non-http(s) URLs never survive. Inline
// styles are limited to the text-formatting properties the Tiptap composer
// and Gmail use; everything else is dropped so a marketing blast can't
// restyle the thread view.
const sanitizeHtml = require('sanitize-html');

const MAX_HTML_BYTES = 200 * 1024; // keep rows bounded; long tails are cut

const OPTIONS = {
  allowedTags: [
    'p', 'br', 'div', 'span', 'a', 'b', 'strong', 'i', 'em', 'u', 's',
    'strike', 'del', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'img',
    'table', 'thead', 'tbody', 'tr', 'td', 'th',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'rel', 'target'],
    img: ['src', 'alt', 'width', 'height'],
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan'],
    // class kept ONLY for the quote-collapsing marker the client looks for
    // (Gmail wraps quoted tails in <div class="gmail_quote">).
    div: ['class', 'style'],
    span: ['style'],
    p: ['style'],
    blockquote: ['class', 'style'],
  },
  allowedClasses: {
    div: ['gmail_quote', 'gmail_attr'],
    blockquote: ['gmail_quote'],
  },
  allowedStyles: {
    '*': {
      'text-align': [/^(left|right|center|justify)$/],
      'font-weight': [/^(bold|[4-9]00)$/],
      'font-style': [/^italic$/],
      'text-decoration': [/^(underline|line-through)$/],
    },
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['https'] },
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }),
  },
  disallowedTagsMode: 'discard',
};

function sanitizeEmailHtml(html) {
  const input = String(html || '').trim();
  if (!input) return null;
  const clean = sanitizeHtml(input, OPTIONS).trim();
  if (!clean) return null;
  return clean.length > MAX_HTML_BYTES ? clean.slice(0, MAX_HTML_BYTES) : clean;
}

module.exports = { sanitizeEmailHtml };
