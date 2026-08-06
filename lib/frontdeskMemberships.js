// Front Desk (Agent 2), Phase C — in-chat MEMBERSHIP signup tool (pay-at-venue).
//
// Mirrors lib/frontdeskBooking.js: the chat agent emits a `membership` object each
// turn ({ intent:'membership', plan, customer, confirm }); this module turns it into
// a real PENDING signup against the shared A2 core and returns a `note` the chat
// controller injects into the agent's next turn so the reply is grounded in reality.
//
// P14 pay-at-venue: signing up online charges NOTHING. The visitor picks a plan and
// leaves their details; the owner signs the agreement + collects payment in person,
// then confirms it in the CMS (the commissionable event). So this tool NEVER shows a
// payment card — its terminal card is `membership_done` ("visit us to start").
//
// Card kinds used: `options` (pick a plan) + `form` (detailsCard) render in the
// widget drawer; `membership_confirm` / `membership_done` render through the widget's
// generic ReceiptCard (title/lines/price/actions) — no widget change needed.
const supabase = require('../config/supabase');
const { createMembershipSignup } = require('../controllers/siteMembershipsController');

const en = (v) => (v && typeof v === 'object' ? (v.en ?? '') : (v || ''));
const norm = (s) => String(s || '').trim().toLowerCase();
const ALLOWED = ['live', 'previewing']; // testable on preview sites, like the booking tool
const money = (cents) => `$${((cents || 0) / 100).toFixed((cents || 0) % 100 === 0 ? 0 : 2)}`;
const per = (interval) => (interval === 'year' ? '/yr' : interval === 'week' ? '/wk' : interval ? '/mo' : '');

// Fuzzy name match: exact, then contains either direction (same as the booking tool).
function bestMatch(items, label, getName) {
  const q = norm(label);
  if (!q) return null;
  let m = items.find((x) => norm(getName(x)) === q);
  if (m) return m;
  m = items.find((x) => norm(getName(x)).includes(q) || q.includes(norm(getName(x))));
  return m || null;
}

const optionsCard = (title, options) => ({ kind: 'options', title, options });

// Collect the visitor's details as a FORM (same shape/discipline as the booking
// tool). All three required: the owner reaches the member to arrange the agreement
// and in-person payment, so a signup with no way to contact them is useless.
const detailsCard = (title) => ({
  kind: 'form',
  title: title || 'Your details',
  hint: 'Nothing is charged online. We share these with the business so they can set up your membership when you visit.',
  submitLabel: 'Continue',
  fields: [
    { name: 'name', label: 'Full name', type: 'text', required: true },
    { name: 'email', label: 'Email', type: 'email', required: true },
    { name: 'phone', label: 'Phone', type: 'tel', required: true },
  ],
});

async function loadMembershipPlans(siteId) {
  const { data } = await supabase
    .from('site_products')
    .select('id, name, description, price_cents, currency, billing_interval, fulfillment_mode, external_url')
    .eq('site_id', siteId)
    .eq('product_type', 'membership')
    .eq('is_active', true)
    .order('display_order');
  return data || [];
}

const priceLabel = (p) => (p.price_cents > 0 ? `${money(p.price_cents)}${per(p.billing_interval)}` : undefined);

// Main entry. Returns { note, card?, quickReplies? } — { note: null } when there's
// nothing to do (the agent's own reply already asks for the missing detail).
async function runMembershipTool({ site, membership }) {
  if (!membership || norm(membership.intent) !== 'membership') return { note: null };

  const siteId = site.id;
  const bizName = site.company?.name || 'the business';

  const plans = await loadMembershipPlans(siteId);
  if (!plans.length) {
    return { note: `MEMBERSHIP NOTE: ${bizName} has no memberships to sign up for online. In ONE short line, invite the visitor to ask at the desk or contact ${bizName}. Do NOT invent plans or prices.` };
  }

  // No plan named yet → show the real plans in the docked options panel.
  if (!membership.plan) {
    const options = plans.map((p) => ({
      label: en(p.name), value: en(p.name),
      sublabel: en(p.description) || undefined,
      price: priceLabel(p),
    })).filter((o) => o.label);
    return {
      note: `MEMBERSHIP NOTE: The visitor wants to join but hasn't picked a plan. A list of the real membership plans is shown. In ONE short line, invite them to choose one. Do NOT list the plans in your text.`,
      card: optionsCard('Choose a membership', options),
    };
  }

  const plan = bestMatch(plans, membership.plan, (p) => en(p.name));
  if (!plan) {
    const list = plans.map((p) => en(p.name)).filter(Boolean).join(', ');
    const options = plans.map((p) => ({ label: en(p.name), value: en(p.name), sublabel: en(p.description) || undefined, price: priceLabel(p) })).filter((o) => o.label);
    return {
      note: `MEMBERSHIP NOTE: There's no plan matching "${membership.plan}". Our plans are: ${list}. In ONE short line, ask the visitor to choose from the list shown.`,
      card: optionsCard('Choose a membership', options),
    };
  }
  const planName = en(plan.name);

  // External / bring-your-own plans (e.g. Wodify) aren't ours to sign up — hand off.
  if (plan.fulfillment_mode === 'external') {
    return {
      note: `MEMBERSHIP NOTE: "${planName}" is managed on ${bizName}'s own booking platform, not here. In ONE short line, point the visitor to continue there (a button is shown). Do NOT collect their details.`,
      card: { kind: 'handoff_booking', title: 'Join', lines: [planName, priceLabel(plan)].filter(Boolean),
        actions: [{ label: 'Continue to join', href: plan.external_url || '/memberships' }] },
    };
  }

  // Gather name + email + phone.
  const cust = membership.customer || {};
  const ready = !!(cust.name && norm(cust.name)) && !!(cust.email && norm(cust.email)) && !!(cust.phone && norm(cust.phone));
  if (!ready) {
    return {
      note: `MEMBERSHIP NOTE: "${planName}" selected. A short form asking for their name, email and phone is shown. In ONE short line ask them to fill it in. Do NOT ask for the details in your text and make clear nothing is charged now.`,
      card: detailsCard('Your details'),
    };
  }

  // Confirm step — a summary + explicit "pay in person" before we create anything.
  if (membership.confirm !== true) {
    return {
      note: `MEMBERSHIP NOTE: A summary of the "${planName}" membership${priceLabel(plan) ? ` (${priceLabel(plan)})` : ''} is shown. Explain in ONE short line that they sign the agreement and pay in person when they visit — nothing is charged online — then ask them to confirm. Set membership.confirm=true ONLY when they say yes.`,
      card: {
        kind: 'membership_confirm',
        title: 'Confirm your membership',
        lines: [planName, priceLabel(plan), 'Sign & pay in person when you visit'].filter(Boolean),
        price: priceLabel(plan),
        actions: [
          { label: 'Sign me up', value: 'Yes, sign me up for the membership.' },
          { label: 'Not now', value: 'Actually, not now.' },
        ],
      },
    };
  }

  // Confirmed → create the pending venue signup via the shared A2 core (NOT an HTTP self-call).
  const [firstName, ...rest] = String(cust.name).trim().split(/\s+/);
  const r = await createMembershipSignup({
    siteId, productId: plan.id,
    customer: { firstName, lastName: rest.join(' ') || null, email: cust.email, phone: cust.phone },
    allowedStatuses: ALLOWED,
  });
  if (!r.ok) {
    return { note: `MEMBERSHIP NOTE: The signup couldn't be completed (${r.message}). Apologise in ONE short line and suggest the visitor visit or contact ${bizName} to join.` };
  }

  const already = r.existing;
  return {
    note: `MEMBERSHIP DONE: ${already ? `The visitor already has a pending or active "${planName}" signup.` : `Signed the visitor up for "${planName}" (pending).`} Warmly confirm in ONE short sentence and tell them to visit ${bizName} to sign the agreement and pay — nothing to pay online. The details are on a card, don't repeat them all. Stop collecting membership details.`,
    card: {
      kind: 'membership_done',
      title: already ? "You're already on the list" : "You're on the list",
      lines: [planName, priceLabel(plan), `Visit ${bizName} to sign your agreement and start`, 'Nothing to pay online'].filter(Boolean),
    },
  };
}

module.exports = { runMembershipTool };
