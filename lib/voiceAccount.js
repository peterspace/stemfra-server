// Voice agent Phase 2 (docs/VOICE_AGENT.md) — caller identification, account
// context, and the safe account ACTIONS for support calls.
//
//  · identifyCaller(fromE164)    caller-ID → { contact, sites } (or null).
//  · buildAccountContext(id)     compact per-site summary string for the voice
//                                system prompt: status, plan, open invoice,
//                                new leads / upcoming bookings (Stacy's own
//                                query shapes, trimmed for phone latency).
//  · executeVoiceAction(...)     the [ACTION:*] executors — password-reset
//                                email (REGISTERED email only), support ticket
//                                (site_activity + support inbox), callback.
//
// SECURITY MODEL: caller-ID identification is SOFT — good enough to read
// account facts back to the caller and to send emails to the ALREADY-REGISTERED
// address, never good enough to change the account or redirect anything to a
// new address (caller ID can be spoofed). Nothing secret is ever spoken; the
// reset link travels by email to the address on file.
// Single-var supabase require per convention.
const supabase = require('../config/supabase');
const { logSiteActivity } = require('./activity');
const { sendMail } = require('./mailer');
const emails = require('../templates/transactionalEmails');

const SUPPORT_INBOX = process.env.SUPPORT_EMAIL || 'support@stemfra.com';

const digits = (s) => String(s || '').replace(/\D/g, '');

function maskEmail(email) {
  const [user, domain] = String(email || '').split('@');
  if (!user || !domain) return '(unknown)';
  return `${user[0]}${'•'.repeat(Math.max(1, Math.min(4, user.length - 1)))}@${domain}`;
}

/** Caller-ID → the owning contact + their sites. Phone formats in `contacts`
 *  vary, so we candidate-match on the last 4 digits in SQL, then compare the
 *  normalized last-10 suffix in JS. Prefers a contact who actually owns sites. */
async function identifyCaller(fromE164) {
  const d = digits(fromE164);
  if (d.length < 7) return null;
  const last10 = d.slice(-10);
  const last4 = d.slice(-4);
  const { data: candidates, error } = await supabase
    .from('contacts')
    .select('id, full_name, first_name, last_name, email, phone, auth_user_id, is_active')
    .ilike('phone', `%${last4}%`)
    .limit(25);
  if (error || !candidates?.length) return null;
  const matches = candidates.filter((c) => digits(c.phone).slice(-10) === last10 && c.is_active !== false);
  if (!matches.length) return null;

  for (const contact of matches) {
    const { data: sites } = await supabase
      .from('sites')
      .select('id, subdomain, custom_domain, status, company:companies(name), vertical:verticals(display_name)')
      .eq('owner_contact_id', contact.id)
      .is('deleted_at', null)
      .limit(5);
    if (sites && sites.length) return { contact, sites };
  }
  return null; // phone matched a contact, but not a site owner → treat as unidentified
}

/** Compact account summary for the voice system prompt. Capped at 3 sites. */
async function buildAccountContext({ contact, sites }) {
  const lines = [];
  const name = contact.first_name || contact.full_name || 'the owner';
  lines.push(`Owner: ${contact.full_name || name} · account email: ${contact.email || '(none on file)'}`);

  for (const site of sites.slice(0, 3)) {
    const [subRes, chargeRes, leadsRes, bookingsRes] = await Promise.all([
      supabase.from('subscriptions')
        .select('status, monthly_amount_cents, currency, provider, current_period_end')
        .eq('site_id', site.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('billing_charges')
        .select('amount_cents, currency, due_date, status, kind')
        .eq('site_id', site.id).eq('status', 'due').order('due_date', { ascending: true }).limit(1).maybeSingle(),
      supabase.from('site_leads').select('id', { count: 'exact', head: true })
        .eq('site_id', site.id).eq('status', 'new'),
      supabase.from('site_bookings').select('id', { count: 'exact', head: true })
        .eq('site_id', site.id).eq('status', 'confirmed').gte('starts_at', new Date().toISOString()),
    ]);
    const sub = subRes.data;
    const charge = chargeRes.data;
    const money = (cents, cur) => `$${(cents / 100).toFixed(0)}${cur && cur !== 'usd' ? ' ' + String(cur).toUpperCase() : ''}`;
    lines.push([
      `Site: "${site.company?.name || site.subdomain}"${site.vertical?.display_name ? ` (${site.vertical.display_name})` : ''}`,
      `${site.custom_domain || site.subdomain + '.stemfra.com'}`,
      `status: ${site.status}`,
      sub ? `plan: ${money(sub.monthly_amount_cents, sub.currency)}/mo (${sub.status})` : 'plan: none on file',
      charge ? `open invoice: ${money(charge.amount_cents, charge.currency)} due ${charge.due_date}` : 'no open invoice',
      Number.isFinite(leadsRes.count) ? `new leads: ${leadsRes.count}` : '',
      Number.isFinite(bookingsRes.count) ? `upcoming bookings: ${bookingsRes.count}` : '',
    ].filter(Boolean).join(' · '));
  }
  if (sites.length > 3) lines.push(`(+${sites.length - 3} more sites)`);
  return lines.join('\n');
}

/** One-stop: identify + context. Returns null or
 *  { contact, sites, contextString, maskedEmail }. */
async function identifyAndBuildContext(fromE164) {
  try {
    const id = await identifyCaller(fromE164);
    if (!id) return null;
    const contextString = await buildAccountContext(id);
    return { ...id, contextString, maskedEmail: maskEmail(id.contact.email) };
  } catch (e) {
    console.error('[voiceAccount] identify failed:', e.message);
    return null;
  }
}

// ─── Actions (the [ACTION:*] executors) ──────────────────────────────────────
// Each returns a short factual result string the brain speaks from. They are
// GUARDED here server-side: no identity → no action, regardless of the model.

async function executeVoiceAction(action, identity, session) {
  if (!identity || !identity.contact) return 'Action refused: the caller is not identified via caller ID. Offer to open a ticket by taking their details for the support team instead.';
  const contact = identity.contact;
  // Multi-site owners: attribute the action to the site the caller actually
  // talked about (name/subdomain mentioned in their recent turns); else site 1.
  const recentText = (session.history || []).filter((m) => m.role === 'user').slice(-8).map((m) => m.content).join(' ').toLowerCase();
  const site = identity.sites.find((st) => {
    const label = String(st.company?.name || '').toLowerCase();
    return (label && recentText.includes(label)) || recentText.includes(String(st.subdomain).toLowerCase());
  }) || identity.sites[0];
  const siteLabel = site ? (site.company?.name || site.subdomain) : 'their account';

  if (action === 'reset_password') {
    if (!contact.email) return 'Action failed: no email is on file for this account. A support ticket is needed.';
    const { error } = await supabase.auth.resetPasswordForEmail(contact.email);
    if (error) return `Action failed (${error.message}). Offer a support ticket instead.`;
    return `Password reset email sent to ${maskEmail(contact.email)} (the address already on the account). It arrives within a minute or two; the link expires after a short time.`;
  }

  if (action === 'ticket') {
    const lastTurns = session.history.filter((m) => m.role === 'user').slice(-6).map((m) => m.content).join(' / ');
    if (site) {
      await logSiteActivity({
        siteId: site.id, actorName: 'Stemfra Voice', action: 'support_ticket_opened',
        entityType: 'support', details: { via: 'voice_call', phone: session.from, issue: lastTurns.slice(0, 500) },
      });
    }
    sendMail({
      fromName: 'Stemfra Voice',
      to: SUPPORT_INBOX,
      replyTo: contact.email || undefined,
      subject: `Support ticket (voice) — ${contact.full_name || 'customer'} · ${siteLabel}`,
      text: `Ticket opened during a voice call.\nCustomer: ${contact.full_name || '?'} · ${contact.email || 'no email'} · ${session.from || 'no phone'}\nSite: ${siteLabel}\nWhat they said (recent): ${lastTurns}`,
      html: emails.staffVoiceSupportNotification({
        callerName: contact.full_name, callerEmail: contact.email, callerPhone: session.from,
        issue: lastTurns.slice(0, 300), summary: `Ticket opened live on the call for ${siteLabel}.`, transcript: null,
      }),
    }).catch((e) => console.error('[voiceAccount] ticket email failed:', e.message));
    session.actionsTaken.push('ticket');
    return `Support ticket opened for ${siteLabel}; the team will email ${maskEmail(contact.email)} today.`;
  }

  if (action === 'callback') {
    sendMail({
      fromName: 'Stemfra Voice',
      to: SUPPORT_INBOX,
      replyTo: contact.email || undefined,
      subject: `Callback requested — ${contact.full_name || 'customer'} · ${session.from || ''}`,
      text: `A customer asked for a staff callback.\nCustomer: ${contact.full_name || '?'} · ${contact.email || 'no email'} · ${session.from || 'no phone'}\nSite: ${siteLabel}`,
    }).catch((e) => console.error('[voiceAccount] callback email failed:', e.message));
    session.actionsTaken.push('callback');
    return `Callback request logged — a teammate will call ${session.from || 'their number'} back today.`;
  }

  return `Unknown action "${action}" — nothing was done.`;
}

module.exports = { identifyCaller, buildAccountContext, identifyAndBuildContext, executeVoiceAction, maskEmail };
