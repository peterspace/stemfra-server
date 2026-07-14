// Public customer email-preference endpoints (N2). No auth — access is gated by
// the signed unsubscribe token (see lib/emailTokens.js). Reachable from the
// "Unsubscribe" link in customer-facing emails.
const supabase = require('./../config/supabase');
const { verifyUnsubscribeToken, unsubscribeToken } = require('../lib/emailTokens');

function page({ title, heading, body, accent = '#161514' }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body{margin:0;background:#F4F3EF;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1A1918}
  .wrap{max-width:520px;margin:12vh auto;padding:0 24px}
  .card{background:#fff;border:1px solid #E9E7E1;border-radius:14px;padding:40px 36px;text-align:center}
  h1{font-size:22px;margin:0 0 12px}
  p{color:#57534E;line-height:1.55;margin:0 0 8px}
  a{color:${accent};font-weight:600}
  .muted{color:#8A867E;font-size:13px;margin-top:22px}
</style></head><body><div class="wrap"><div class="card">
  <h1>${heading}</h1>${body}
  <p class="muted">Sent by Stemfra on behalf of the business.</p>
</div></div></body></html>`;
}

// GET /api/site-emails/unsubscribe?token=...
async function unsubscribe(req, res) {
  const id = verifyUnsubscribeToken(req.query.token);
  if (!id) {
    return res.status(400).type('html').send(page({
      title: 'Invalid link', heading: 'This link is no longer valid',
      body: '<p>The unsubscribe link is invalid or has expired. If you keep receiving unwanted emails, reply to one and ask the business to remove you.</p>',
    }));
  }
  const { data: c } = await supabase
    .from('site_customers')
    .select('id, first_name, email_opt_out')
    .eq('id', id).maybeSingle();
  if (!c) {
    return res.status(404).type('html').send(page({ title: 'Not found', heading: 'We could not find your details', body: '<p>This link no longer matches an active record.</p>' }));
  }
  if (!c.email_opt_out) {
    await supabase.from('site_customers').update({ email_opt_out: true }).eq('id', id);
  }
  const resubUrl = `${process.env.PUBLIC_BASE_URL || 'https://api.stemfra.com'}/api/site-emails/resubscribe?token=${encodeURIComponent(unsubscribeToken(id))}`;
  return res.type('html').send(page({
    title: 'Unsubscribed',
    heading: 'You’re unsubscribed',
    body: `<p>${c.first_name ? c.first_name + ', you' : 'You'} will no longer receive reminder or promotional emails.</p>
           <p>You’ll still get essential messages about bookings you make — like confirmations and changes.</p>
           <p style="margin-top:18px">Changed your mind? <a href="${resubUrl}">Resubscribe</a></p>`,
  }));
}

// GET /api/site-emails/resubscribe?token=...
async function resubscribe(req, res) {
  const id = verifyUnsubscribeToken(req.query.token);
  if (!id) {
    return res.status(400).type('html').send(page({ title: 'Invalid link', heading: 'This link is no longer valid', body: '<p>The link is invalid or has expired.</p>' }));
  }
  await supabase.from('site_customers').update({ email_opt_out: false }).eq('id', id);
  return res.type('html').send(page({
    title: 'Resubscribed', heading: 'You’re resubscribed',
    body: '<p>You’ll receive reminders and updates again. You can unsubscribe any time from the link in our emails.</p>',
  }));
}

module.exports = { unsubscribe, resubscribe };
