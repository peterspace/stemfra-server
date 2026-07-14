// The ONE branded email base (Case 9). Every transactional email the server
// sends renders through this — same card, same type scale, same footer — so
// all mail reads as one system. Direction per Peter (2026-07-10): Hostinger's
// STRUCTURE (centered logo header, bold heading, label/value summary table,
// tidy fine-print footer) with Claude's RESTRAINT (soft warm background, one
// white card, a single dark button, no decoration).
//
// Two brand modes:
//   · Stemfra (default) — platform → its customers/staff/prospect-owners.
//     Logo + wordmark header, Stemfra footer.
//   · Tenant — a BUSINESS → its own visitors (booking confirmations, and the
//     B-family lifecycle mail later). The business name is the header wordmark
//     (their logo when provided) and the footer says "Sent by {business} ·
//     powered by Stemfra". Never brand a visitor's confirmation as Stemfra.
//
// Email-safe by construction: tables + inline styles only, system font stack,
// no external CSS. Preview every variant at /dev/preview (dev only).
//
// PLAIN-TEXT RULE: callers keep sending a `text` alternative alongside `html`
// (nodemailer multipart) — never drop it; some clients and spam filters want it.

const T = {
  bg: '#F4F3EF',        // soft warm canvas (the Claude nod)
  card: '#FFFFFF',
  border: '#E9E7E1',
  hairline: '#EFEDE7',
  ink: '#1A1918',
  body: '#57534E',
  muted: '#8A867E',
  button: '#161514',
  panel: '#FAF9F6',     // quote/message wells
  accent: '#6366F1',    // Stemfra violet (CMS accent) — Stemfra-branded buttons/numbers
  link: '#1a73e8',      // hyperlink blue (Peter, 2026-07-13 — Google-style links)
};
const FONT = "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif";

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
const nl2br = (s) => escapeHtml(s).replace(/\n/g, '<br/>');

// Logos are stored as transparent WebP (correct on the colored backgrounds of a
// business's actual site). But email clients handle WebP alpha badly — Gmail
// drops it and paints the transparent corners BLACK; Outlook won't render WebP
// at all. So for EMAIL we flatten Cloudinary logos onto white (the card color)
// and force PNG: no alpha to mishandle, universal client support, corners blend
// invisibly into the white card. Non-Cloudinary URLs pass through untouched.
function emailLogoUrl(url) {
  if (!url || typeof url !== 'string') return url;
  return url.replace(/(res\.cloudinary\.com\/[^/]+\/image\/upload)\//, '$1/b_white,f_png/');
}

// ─── Blocks (exported so callers can compose custom bodies) ──────────────────

function button({ label, url, color }) {
  return `<table cellpadding="0" cellspacing="0" role="presentation" style="margin:28px auto 0;"><tr>
    <td style="border-radius:10px;background:${color || T.button};">
      <a href="${escapeHtml(url)}" style="display:inline-block;padding:13px 30px;font-family:${FONT};font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">${escapeHtml(label)}</a>
    </td></tr></table>`;
}

// Hostinger-style summary: label left, value right; { bold } rows for totals.
function rowsTable(rows) {
  const tr = rows.filter(Boolean).map((r, i) => `
    <tr>
      <td style="padding:12px 0;font-family:${FONT};font-size:13px;color:${T.muted};${i ? `border-top:1px solid ${T.hairline};` : ''}${r.bold ? `font-weight:600;color:${T.ink};` : ''}">${escapeHtml(r.label)}</td>
      <td align="right" style="padding:12px 0;font-family:${FONT};font-size:14px;color:${T.ink};font-weight:${r.bold ? 700 : 600};${i ? `border-top:1px solid ${T.hairline};` : ''}">${escapeHtml(r.value)}</td>
    </tr>`).join('');
  return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:24px 0 0;">${tr}</table>`;
}

// A warm "coupon" band for a lifecycle-email discount (birthday/win-back/…).
// Brand-neutral (no per-tenant color): soft amber fill + dashed hairline so it
// reads as an offer without a hardcoded brand hue.
function discountBlock(text) {
  return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:24px 0 0;"><tr>
    <td align="center" style="padding:15px 18px;background:#FBF5E6;border:1px dashed #D9B871;border-radius:12px;font-family:${FONT};font-size:15px;font-weight:700;line-height:1.5;color:${T.ink};">${escapeHtml(text)}</td>
  </tr></table>`;
}

// A quoted block (a lead's message, what an owner said, …).
function quoteBlock(text, label) {
  return `<div style="margin:24px 0 0;padding:16px 18px;background:${T.panel};border:1px solid ${T.hairline};border-radius:12px;">
    ${label ? `<p style="margin:0 0 6px;font-family:${FONT};font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${T.muted};">${escapeHtml(label)}</p>` : ''}
    <p style="margin:0;font-family:${FONT};font-size:14px;line-height:1.65;color:${T.body};">${nl2br(text)}</p>
  </div>`;
}

// ─── The shell ────────────────────────────────────────────────────────────────

function header(brand) {
  if (brand && brand.name && !brand.stemfra) {
    // Tenant mode — the business is the sender. With a logo: logo on top, the
    // business name under it (never logo-only — the name is the identity).
    const nameSpan = `<span style="display:block;font-family:${FONT};font-size:${brand.logoUrl ? '15px' : '19px'};font-weight:700;letter-spacing:-.2px;color:${T.ink};${brand.logoUrl ? 'margin-top:10px;' : ''}">${escapeHtml(brand.name)}</span>`;
    const logo = brand.logoUrl
      ? `<img src="${escapeHtml(emailLogoUrl(brand.logoUrl))}" alt="${escapeHtml(brand.name)}" height="40" style="display:inline-block;height:40px;width:auto;border:0;"/>${nameSpan}`
      : nameSpan;
    return `<td align="center" style="padding:34px 40px 6px;">${logo}</td>`;
  }
  const logoUrl = process.env.LOGO_URL || 'https://stemfra.com/stemfra_logo.png';
  return `<td align="center" style="padding:34px 40px 6px;">
    <img src="${escapeHtml(logoUrl)}" alt="STEMfra" height="34" style="display:inline-block;vertical-align:middle;height:34px;width:auto;border:0;margin-right:-4px;"/><span style="display:inline-block;vertical-align:middle;font-family:${FONT};font-size:18px;font-weight:600;color:#000;">STEMfra</span>
  </td>`;
}

function footer(brand, reason, security, unsubscribeUrl, footerLinks) {
  const bizName = brand && brand.url
    ? `<a href="${brand.url}" style="color:${T.link};">${escapeHtml(brand.name)}</a>`
    : escapeHtml(brand && brand.name ? brand.name : '');
  const line = brand && brand.name && !brand.stemfra
    ? `Sent by ${bizName} &middot; website powered by <a href="https://stemfra.com" style="color:${T.link};">Stemfra</a>`
    : `&copy; ${new Date().getFullYear()} Stemfra &middot; <a href="https://stemfra.com" style="color:${T.link};">stemfra.com</a>`;
  const links = (footerLinks && footerLinks.length)
    ? footerLinks.map((l) => `<a href="${l.url}" style="color:${T.link};text-decoration:underline;">${escapeHtml(l.label)}</a>`).join(' &middot; ')
    : '';
  return `
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr><td align="center" style="padding:22px 40px 0;">
    ${security ? `<p style="margin:0 0 6px;font-family:${FONT};font-size:12px;line-height:1.6;color:${T.muted};">${security}</p>` : ''}
    ${reason ? `<p style="margin:0 0 6px;font-family:${FONT};font-size:12px;line-height:1.6;color:${T.muted};">${escapeHtml(reason)}</p>` : ''}
    ${links ? `<p style="margin:0 0 8px;font-family:${FONT};font-size:12px;line-height:1.8;color:${T.muted};">${links}</p>` : ''}
    <p style="margin:0;font-family:${FONT};font-size:12px;color:${T.muted};">${line}</p>
    ${unsubscribeUrl ? `<p style="margin:6px 0 0;font-family:${FONT};font-size:12px;color:${T.muted};"><a href="${unsubscribeUrl}" style="color:${T.link};text-decoration:underline;">Unsubscribe from these emails</a></p>` : ''}
  </td></tr></table>`;
}

/**
 * Render a full email document.
 * @param {object} o
 * @param {string} o.heading            The bold H1 inside the card.
 * @param {string} [o.preheader]        Hidden inbox-preview text.
 * @param {string[]} [o.paragraphs]     Body copy (escaped; \n → <br>).
 * @param {string} [o.bodyHtml]         Extra pre-built blocks (rowsTable/quoteBlock/…).
 * @param {{label:string,value:string,bold?:boolean}[]} [o.rows] Summary table.
 * @param {{label:string,url:string}} [o.cta]  The single dark button.
 * @param {string} [o.note]             Small muted line under the button.
 * @param {{name:string,logoUrl?:string,stemfra?:boolean}} [o.brand] Tenant brand; omit for Stemfra.
 * @param {string} [o.reason]           Footer "why you received this" line.
 */
function renderEmail({ heading, preheader, paragraphs = [], bodyHtml = '', rows, cta, note, brand, reason, security, unsubscribeUrl, footerLinks, bodyAlign = 'left' }) {
  const tenant = !!(brand && brand.name && !brand.stemfra);
  const paras = paragraphs.filter(Boolean).map(p =>
    `<p style="margin:0 0 14px;font-family:${FONT};font-size:15px;line-height:1.7;color:${T.body};text-align:${bodyAlign};">${nl2br(p)}</p>`
  ).join('');
  return `<!doctype html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:${T.bg};">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>` : ''}
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:${T.bg};padding:44px 12px 56px;"><tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" role="presentation" style="max-width:560px;width:100%;background:${T.card};border:1px solid ${T.border};border-radius:16px;">
      <tr>${header(brand)}</tr>
      <tr><td style="padding:22px 40px 36px;">
        <h1 style="margin:0 0 16px;font-family:${FONT};font-size:23px;font-weight:700;letter-spacing:-.3px;line-height:1.3;color:${T.ink};text-align:center;">${escapeHtml(heading)}</h1>
        ${paras}
        ${rows && rows.length ? rowsTable(rows) : ''}
        ${bodyHtml}
        ${cta ? button({ ...cta, color: cta.color || (tenant ? T.button : T.accent) }) : ''}
        ${note ? `<p style="margin:16px 0 0;font-family:${FONT};font-size:13px;line-height:1.6;color:${T.muted};text-align:${bodyAlign};">${nl2br(note)}</p>` : ''}
      </td></tr>
    </table>
    ${footer(brand, reason, security, unsubscribeUrl, footerLinks)}
  </td></tr></table>
</body></html>`;
}

module.exports = { renderEmail, rowsTable, quoteBlock, discountBlock, button, escapeHtml, T, FONT };
