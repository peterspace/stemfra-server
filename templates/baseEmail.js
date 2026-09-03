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
  accent: '#6366F1',    // legacy violet — TENANT-mode fallbacks only; Stemfra mode uses S below
  link: '#1a73e8',      // hyperlink blue (Peter, 2026-07-13 — Google-style links)
};
const FONT = "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif";

// ─── Stemfra brand tokens (Peter, 2026-07-21: the Bentley-register redesign) ──
// Approved via the /dev design study: chocolate bands, icon-over-wordmark
// lockup, light 300-weight display type, tracked-out uppercase micro-labels,
// hairline rows, one big "amount" moment, square chocolate + ghost buttons.
// TENANT mode was redesigned too (Case 2 — tenantDocument() below, selected by
// renderEmail). An earlier version of this comment said Case 2 was pending; the
// implementation landed and the comment lagged, which sent an audit chasing it.
const S = {
  canvas: '#f6f6f4',    // page background
  card: '#ffffff',
  band: '#211c18',      // Stemfra chocolate — header/footer bands, buttons, eyebrow
  ink: '#211c18',
  copy: '#5a5f5c',
  micro: '#8a8f8c',     // uppercase micro-labels
  hairline: '#e8e8e5',
  bandText: '#c9ccc9',  // legible text/links on the chocolate bands
  ghost: '#c9ccc9',     // ghost-button border
};
const SFONT = "'Helvetica Neue',Helvetica,Arial,sans-serif";
const STEMFRA_LOGO = process.env.STEMFRA_EMAIL_LOGO_URL
  || 'https://res.cloudinary.com/dvdbec2fe/image/upload/v1784633359/stemfra_assets/email/s-mark-cream.png';
// Ink mark for the LIGHT header (prospecting register: logo on white, no band).
const STEMFRA_LOGO_INK = process.env.STEMFRA_EMAIL_LOGO_INK_URL
  || 'https://res.cloudinary.com/dvdbec2fe/image/upload/v1787088069/stemfra_assets/email/s-mark-ink.png';

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
function emailLogoUrl(url, bg = 'white') {
  if (!url || typeof url !== 'string') return url;
  return url.replace(/(res\.cloudinary\.com\/[^/]+\/image\/upload)\//, `$1/b_${bg},f_png/`);
}

// Relative luminance → pick legible text (#fff vs ink) on a brand color, so an
// accent band always reads whether the brand is dark (navy/chocolate) or light
// (lime/terracotta).
function luminance(hex) {
  const c = String(hex || '').replace('#', '');
  if (c.length !== 6) return 1;
  const ch = (i) => {
    const v = parseInt(c.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch(0) + 0.7152 * ch(2) + 0.0722 * ch(4);
}
const onColor = (hex) => (luminance(hex) > 0.55 ? T.ink : '#ffffff');

// Email clients can't reliably load web fonts, so map the site's display font to
// an email-safe stack that keeps its CHARACTER (serif brands get a serif heading).
function fontStack(font) {
  const serif = /playfair|cormorant|fraunces|bodoni|dm serif|newsreader|lora|libre|garamond|georgia|times|pt serif|serif/i.test(font || '');
  return serif ? "Georgia,'Times New Roman',serif" : FONT;
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

// ─── Stemfra-mode blocks (Bentley register) ──────────────────────────────────

// The one moment of scale: amount between two chocolate rules. Exported for the
// billing builders (invoice / dunning / receipt).
function amountBlock({ label, value }) {
  return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:26px 0 0;"><tr>
    <td align="center" style="border-top:1px solid ${S.band};border-bottom:1px solid ${S.band};padding:30px 0 32px;">
      <div style="font-family:${SFONT};font-weight:400;font-size:10px;letter-spacing:0.28em;color:${S.micro};text-transform:uppercase;">${escapeHtml(label)}</div>
      <div style="font-family:${SFONT};font-weight:200;font-size:44px;letter-spacing:0.02em;color:${S.ink};margin-top:12px;">${escapeHtml(value)}</div>
    </td></tr></table>`;
}

function sRows(rows) {
  const tr = rows.filter(Boolean).map((r) => `
    <tr>
      <td style="padding:16px 0;border-top:1px solid ${S.hairline};font-family:${SFONT};font-weight:400;font-size:10px;letter-spacing:0.22em;color:${S.micro};text-transform:uppercase;">${escapeHtml(r.label)}</td>
      <td align="right" style="padding:16px 0;border-top:1px solid ${S.hairline};font-family:${SFONT};font-weight:300;font-size:15px;color:${S.ink};">${escapeHtml(r.value)}</td>
    </tr>`).join('');
  return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:26px 0 0;">${tr}</table>`;
}

// Square buttons: solid chocolate primary + optional ghost secondary.
function sButtons(cta, cta2) {
  const primary = `
    <td style="background:${S.band};">
      <a href="${escapeHtml(cta.url)}" style="display:inline-block;padding:17px 44px;font-family:${SFONT};font-weight:400;font-size:12px;letter-spacing:0.24em;color:#ffffff;text-decoration:none;text-transform:uppercase;">${escapeHtml(cta.label)}</a>
    </td>`;
  const secondary = cta2 ? `
    <td style="width:14px;font-size:0;">&nbsp;</td>
    <td style="border:1px solid ${S.ghost};">
      <a href="${escapeHtml(cta2.url)}" style="display:inline-block;padding:16px 36px;font-family:${SFONT};font-weight:400;font-size:12px;letter-spacing:0.24em;color:${S.ink};text-decoration:none;text-transform:uppercase;">${escapeHtml(cta2.label)}</a>
    </td>` : '';
  return `<table cellpadding="0" cellspacing="0" role="presentation" style="margin:34px auto 0;"><tr>${primary}${secondary}</tr></table>`;
}

function stemfraDocument({ eyebrow, heading, preheader, paragraphs = [], bodyHtml = '', rows, amount, cta, cta2, note, reason, security, unsubscribeUrl, footerLinks, heroImageUrl, heroImageAlt = '', heroImageUrlHref, align = 'left', ctaFirst = false, headerStyle = 'band', leadIn, headingWeight = 300, plainFooter = false }) {
  // `align:'center'` + `heroImageUrl` = the prospecting register (Bentley
  // brochure anatomy, 2026-08-18): logo band → one full-width image → centered
  // headline → one CTA (+ optional ghost CTA) → two short paragraphs.
  const ta = align === 'center' ? 'text-align:center;' : '';
  const paras = paragraphs.filter(Boolean).map(p =>
    `<p style="margin:22px 0 0;font-family:${SFONT};font-weight:300;font-size:15px;line-height:1.75;color:${S.copy};${ta}">${nl2br(p)}</p>`
  ).join('');
  const heroImg = heroImageUrl ? `
      <tr><td style="background:${S.card};padding:${leadIn ? '26px' : '36px'} 40px 0;">
        ${heroImageUrlHref ? `<a href="${escapeHtml(heroImageUrlHref)}" style="display:block;">` : ''}<img src="${escapeHtml(heroImageUrl)}" alt="${escapeHtml(heroImageAlt)}" width="540" style="display:block;width:100%;max-width:540px;height:auto;border:0;"/>${heroImageUrlHref ? '</a>' : ''}
      </td></tr>` : '';
  const links = (footerLinks && footerLinks.length)
    ? `<div style="font-family:${SFONT};font-weight:400;font-size:9px;letter-spacing:0.30em;color:${S.bandText};text-transform:uppercase;">${
        footerLinks.map((l) => `<a href="${escapeHtml(l.url)}" style="color:${S.bandText};text-decoration:none;">${escapeHtml(l.label)}</a>`).join('&nbsp;&nbsp;&nbsp;&nbsp;')
      }</div>`
    : '';
  return `<!doctype html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:${S.canvas};">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>` : ''}
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:${S.canvas};"><tr><td align="center" style="padding:48px 16px 64px;">
    <table width="620" cellpadding="0" cellspacing="0" role="presentation" style="width:620px;max-width:100%;">

      ${headerStyle === 'light' ? `<tr><td align="center" style="background:${S.card};padding:40px 48px 8px;">
        <img src="${escapeHtml(STEMFRA_LOGO_INK)}" alt="Stemfra" width="30" style="display:block;margin:0 auto 10px;height:auto;width:30px;border:0;"/>
        <div style="font-family:${SFONT};font-weight:300;font-size:16px;letter-spacing:0.42em;padding-left:0.42em;color:${S.ink};">STEMFRA</div>
      </td></tr>` : `<tr><td align="center" style="background:${S.band};padding:32px 48px 28px;">
        <img src="${escapeHtml(STEMFRA_LOGO)}" alt="Stemfra" width="34" style="display:block;margin:0 auto 12px;height:auto;width:34px;border:0;"/>
        <div style="font-family:${SFONT};font-weight:300;font-size:20px;letter-spacing:0.42em;padding-left:0.42em;color:#ffffff;">STEMFRA</div>
      </td></tr>`}
      ${leadIn ? `<tr><td align="center" style="background:${S.card};padding:34px 60px 0;">
        <div style="font-family:${SFONT};font-weight:300;font-size:30px;line-height:1.25;color:${S.ink};text-align:center;">${escapeHtml(leadIn)}</div>
      </td></tr>` : ''}

      ${heroImg}
      <tr><td style="background:${S.card};padding:${heroImageUrl ? (heading || eyebrow ? '30px' : '8px') : '52px'} 60px 44px;${ta}">
        ${eyebrow ? `<div style="font-family:${SFONT};font-weight:400;font-size:11px;letter-spacing:0.28em;color:${S.band};text-transform:uppercase;${ta}">${escapeHtml(eyebrow)}</div>` : ''}
        ${heading ? `<div style="font-family:${SFONT};font-weight:${headingWeight};font-size:30px;line-height:1.25;color:${S.ink};margin-top:${eyebrow ? '18px' : '0'};${ta}">${escapeHtml(heading)}</div>` : ''}
        ${ctaFirst && cta ? `<table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr><td align="center">${sButtons(cta, cta2)}</td></tr></table>` : ''}
        ${paras}
        ${rows && rows.length ? sRows(rows) : ''}
        ${amount ? amountBlock(amount) : ''}
        ${bodyHtml}
        ${!ctaFirst && cta ? `<table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr><td align="center">${sButtons(cta, cta2)}</td></tr></table>` : ''}
        ${note ? `<p style="margin:26px auto 0;max-width:420px;font-family:${SFONT};font-weight:300;font-size:13px;line-height:1.7;color:${S.micro};text-align:center;">${nl2br(note)}</p>` : ''}
      </td></tr>

      <tr><td align="center" style="background:${S.band};padding:30px 48px 34px;">
        ${links}
        ${security ? `<div style="font-family:${SFONT};font-weight:300;font-size:10px;letter-spacing:0.16em;color:${S.bandText};text-transform:uppercase;margin-top:14px;line-height:1.8;">${escapeHtml(security)}</div>` : ''}
        ${reason ? `<div style="font-family:${SFONT};font-weight:300;font-size:10px;letter-spacing:0.16em;color:${S.bandText};text-transform:uppercase;margin-top:${links || security ? '14px' : '0'};line-height:1.8;">${escapeHtml(reason)}</div>` : ''}
        <div style="font-family:${SFONT};font-weight:300;font-size:10px;letter-spacing:0.20em;color:${S.bandText};margin-top:12px;">
          ${plainFooter
            ? `&copy; ${new Date().getFullYear()} STEMFRA LLC&nbsp;&nbsp;|&nbsp;&nbsp;STEMFRA.COM&nbsp;&nbsp;|&nbsp;&nbsp;SUPPORT@STEMFRA.COM`
            : `&copy; ${new Date().getFullYear()} STEMFRA LLC&nbsp;&nbsp;|&nbsp;&nbsp;<a href="https://stemfra.com" style="color:${S.bandText};text-decoration:underline;">STEMFRA.COM</a>&nbsp;&nbsp;|&nbsp;&nbsp;<a href="mailto:support@stemfra.com" style="color:${S.bandText};text-decoration:underline;">SUPPORT@STEMFRA.COM</a>`}
        </div>
        ${unsubscribeUrl ? `<div style="font-family:${SFONT};font-weight:300;font-size:10px;letter-spacing:0.16em;text-transform:uppercase;margin-top:12px;"><a href="${escapeHtml(unsubscribeUrl)}" style="color:${S.bandText};text-decoration:underline;">Unsubscribe from these emails</a></div>` : ''}
      </td></tr>

    </table>
  </td></tr></table>
</body></html>`;
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

// ─── Tenant-mode document (Case 2 — the business's OWN brand, popup style) ────
// Modeled on a site popup: a PHOTO on the left, the message on the RIGHT (accent
// eyebrow + serif heading + summary), then the shared "sent by … powered by
// Stemfra" footer. Single content column when a site has no photo. The accent
// colors the eyebrow + any button; the logo sits on white in the content column.
function tenantDocument({ brand, heading, preheader, paragraphs = [], bodyHtml = '', rows, cta, note, reason, security, unsubscribeUrl, footerLinks }) {
  const accent = /^#[0-9a-f]{6}$/i.test(brand.accent || '') ? brand.accent : T.ink;
  const headFont = fontStack(brand.font);
  const logo = brand.logoUrl
    ? `<img src="${escapeHtml(emailLogoUrl(brand.logoUrl, 'white'))}" alt="${escapeHtml(brand.name)}" height="30" style="display:block;margin:0 0 18px;height:30px;width:auto;border:0;"/>`
    : '';
  const paras = paragraphs.filter(Boolean).map((p) =>
    `<p style="margin:0 0 14px;font-family:${FONT};font-size:15px;line-height:1.7;color:${T.body};">${nl2br(p)}</p>`
  ).join('');
  const content = `
    ${logo}
    <!-- Business name uses the dark ink (same as the heading), NOT the tenant
         accent — a light accent (e.g. lime) was illegible on the white card. -->
    <div style="font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${T.ink};margin-bottom:14px;">${escapeHtml(brand.name)}</div>
    <h1 style="margin:0 0 16px;font-family:${headFont};font-size:27px;font-weight:700;line-height:1.2;color:${T.ink};">${escapeHtml(heading)}</h1>
    ${paras}
    ${rows && rows.length ? rowsTable(rows) : ''}
    ${bodyHtml}
    ${cta ? button({ ...cta, color: cta.color || accent }) : ''}
    ${note ? `<p style="margin:18px 0 0;font-family:${FONT};font-size:13px;line-height:1.6;color:${T.muted};">${nl2br(note)}</p>` : ''}`;
  const photo = brand.photoUrl;
  // The photo/content cells carry classes so the mobile media query (in <head>)
  // can stack them: photo becomes a 150px top banner, content goes full-width.
  // Clients that ignore <style> (old desktop Outlook) keep the two-column
  // layout, which is fine at desktop widths — the mobile squeeze was the bug
  // (230px photo left ~150px for the text on a phone).
  const cardInner = photo
    ? `<table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr>
        <td width="230" class="sf-photo" style="padding:0;background-color:${accent};background-image:url('${escapeHtml(photo)}');background-position:center;background-size:cover;background-repeat:no-repeat;"></td>
        <td class="sf-body" style="padding:40px 38px;vertical-align:top;background:${T.card};">${content}</td>
      </tr></table>`
    : `<table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr><td style="padding:40px 40px;background:${T.card};">${content}</td></tr></table>`;
  const bizName = brand.url ? `<a href="${brand.url}" style="color:${T.link};">${escapeHtml(brand.name)}</a>` : escapeHtml(brand.name);
  const links = (footerLinks && footerLinks.length)
    ? footerLinks.map((l) => `<a href="${l.url}" style="color:${T.link};text-decoration:underline;">${escapeHtml(l.label)}</a>`).join(' &middot; ') : '';
  return `<!doctype html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  @media only screen and (max-width:480px){
    .sf-photo{display:block !important;width:100% !important;height:150px !important;}
    .sf-body{display:block !important;width:100% !important;padding:28px 22px !important;box-sizing:border-box !important;}
  }
</style></head>
<body style="margin:0;padding:0;background:${T.bg};">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>` : ''}
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:${T.bg};padding:44px 12px 56px;"><tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;width:100%;background:${T.card};border-radius:18px;overflow:hidden;border:1px solid ${T.border};">
      <tr><td style="padding:0;">${cardInner}</td></tr>
    </table>
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr><td align="center" style="padding:22px 40px 0;">
      ${security ? `<p style="margin:0 0 6px;font-family:${FONT};font-size:12px;line-height:1.6;color:${T.muted};">${security}</p>` : ''}
      ${reason ? `<p style="margin:0 0 6px;font-family:${FONT};font-size:12px;line-height:1.6;color:${T.muted};">${escapeHtml(reason)}</p>` : ''}
      ${links ? `<p style="margin:0 0 8px;font-family:${FONT};font-size:12px;line-height:1.8;color:${T.muted};">${links}</p>` : ''}
      <p style="margin:0;font-family:${FONT};font-size:12px;color:${T.muted};">Sent by ${bizName} &middot; powered by <a href="https://stemfra.com" style="color:${T.link};">Stemfra</a></p>
      ${unsubscribeUrl ? `<p style="margin:6px 0 0;font-family:${FONT};font-size:12px;color:${T.muted};"><a href="${unsubscribeUrl}" style="color:${T.link};text-decoration:underline;">Unsubscribe from these emails</a></p>` : ''}
    </td></tr></table>
  </td></tr></table>
</body></html>`;
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
function renderEmail({ heading, eyebrow, preheader, paragraphs = [], bodyHtml = '', rows, amount, cta, cta2, note, brand, reason, security, unsubscribeUrl, footerLinks, bodyAlign = 'left', heroImageUrl, heroImageAlt, heroImageUrlHref, align, ctaFirst, headerStyle, leadIn, headingWeight, plainFooter }) {
  const tenant = !!(brand && brand.name && !brand.stemfra);
  if (!tenant) {
    // Stemfra brand mode → the Bentley-register chocolate document.
    return stemfraDocument({ eyebrow, heading, preheader, paragraphs, bodyHtml, rows, amount, cta, cta2, note, reason, security, unsubscribeUrl, footerLinks, heroImageUrl, heroImageAlt, heroImageUrlHref, align, ctaFirst, headerStyle, leadIn, headingWeight, plainFooter });
  }
  // Tenant brand mode → the Case-2 popup document (the business's own colors).
  return tenantDocument({ brand, heading, preheader, paragraphs, bodyHtml, rows, cta, note, reason, security, unsubscribeUrl, footerLinks, bodyAlign });
}

module.exports = { renderEmail, rowsTable, quoteBlock, discountBlock, button, amountBlock, escapeHtml, T, FONT, S, SFONT };
