// Front Desk — structured lists.
//
// When a visitor asks "what do you offer?", "what are your hours?", "who teaches?",
// the answer is a LIST. Left to prose the agent produces comma-separated text with
// quoted names and no way to act on any of it, and it can quietly invent an item.
//
// So the agent does not write the list. It only CLASSIFIES the question — it emits
// `{ list: { source: 'services' } }` — and this module builds the card from the
// site's real data. Two wins: the rows are always true, and each one can carry a
// `value` that makes it tappable, so "Power Yoga" starts a booking instead of
// being dead text the visitor has to retype.

// sites.business_hours is keyed by 3-letter day ('mon'), but the CMS hours editor
// and older seeds have both forms in the wild, so accept either. Getting this wrong
// silently reports the business as CLOSED every day, which is worse than no answer.
const supabase = require('../config/supabase');

/** site_products name/description are i18n jsonb; buildSiteContext already
 *  flattens services/team, but products are loaded here directly. */
const en = (v) => (typeof v === 'string' ? v : v?.en || '');

// Where each product kind is actually purchased. A list row that only names a
// price and gives no way to act on it is why the agent used to say "see our
// memberships page" with nothing to tap.
const PRODUCT_PAGE = { membership: '/memberships', class_pack: '/book' };

const DAYS = [
  { keys: ['mon', 'monday'], label: 'Mon' },
  { keys: ['tue', 'tuesday'], label: 'Tue' },
  { keys: ['wed', 'wednesday'], label: 'Wed' },
  { keys: ['thu', 'thursday'], label: 'Thu' },
  { keys: ['fri', 'friday'], label: 'Fri' },
  { keys: ['sat', 'saturday'], label: 'Sat' },
  { keys: ['sun', 'sunday'], label: 'Sun' },
];

const money = (cents, mode) => {
  if (typeof cents !== 'number' || cents <= 0) return undefined;
  const v = `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
  return mode === 'from' ? `from ${v}` : v;
};

/** "9:00 AM" from "09:00" / "09:00:00". Left as-is if it doesn't parse. */
const clock = (raw) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(raw || '').trim());
  if (!m) return String(raw || '');
  let h = Number(m[1]);
  const suffix = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m[2]} ${suffix}`;
};

/** Collapse contiguous days that share hours: Mon-Fri / Sat / Sun closed. */
function hoursRows(hours) {
  if (!hours || typeof hours !== 'object') return [];
  const rows = [];
  let run = null;
  let matchedAny = false;
  const flush = () => {
    if (!run) return;
    const label = run.from === run.to ? run.from : `${run.from} to ${run.to}`;
    rows.push({ label, meta: run.text });
    run = null;
  };
  for (const day of DAYS) {
    const key = day.keys.find((k) => hours[k]);
    const d = key ? hours[key] : null;
    if (d) matchedAny = true;
    const text = !d || d.closed || !d.open || !d.close ? 'Closed' : `${clock(d.open)} to ${clock(d.close)}`;
    if (run && run.text === text) run.to = day.label;
    else { flush(); run = { from: day.label, to: day.label, text }; }
  }
  flush();
  // No key matched at all → we don't know the hours. Say nothing rather than
  // confidently announcing the business is shut.
  return matchedAny ? rows : [];
}

/**
 * @param source  what the agent said the visitor asked for
 * @param ctx     buildSiteContext output (already loaded for the turn — no re-query)
 * @param packs   class packs, only loaded when the site sells them
 * @returns a `list` card, or null when there's nothing real to show (the agent's
 *          own words then stand alone — better than an empty box)
 */
/** Sellable products (memberships, class packs) straight from the site. */
async function loadProducts(siteId, types) {
  const { data } = await supabase
    .from('site_products')
    .select('name, description, price_cents, product_type, billing_interval, fulfillment_mode, external_url, metadata')
    .eq('site_id', siteId).in('product_type', types).eq('is_active', true)
    .order('display_order');
  return data || [];
}

const per = (interval) => (interval === 'year' ? '/yr' : interval === 'week' ? '/wk' : interval ? '/mo' : '');

async function buildListCard(source, ctx, siteId) {
  const src = String(source || '').trim().toLowerCase();
  const services = (ctx?.services || []).filter((s) => s.active !== false);

  if (src === 'services' || src === 'classes') {
    // Only offer to book what is genuinely bookable; the rest still listed, just flat.
    const items = services
      .filter((s) => (src === 'classes' ? s.kind === 'class' : true))
      .map((s) => ({
        label: s.name,
        sublabel: s.duration_minutes ? `${s.duration_minutes} min` : undefined,
        meta: money(s.price_cents, s.price_mode),
        value: s.bookable ? s.name : undefined,
      }));
    if (!items.length) return null;
    return { kind: 'list', title: src === 'classes' ? 'Our classes' : 'What we offer', items };
  }

  if (src === 'team' || src === 'staff') {
    const items = (ctx?.team || []).filter((t) => t.active !== false)
      .map((t) => ({ label: t.name, sublabel: t.role || undefined }));
    if (!items.length) return null;
    return { kind: 'list', title: 'The team', items };
  }

  if (src === 'hours') {
    const items = hoursRows(ctx?.hours);
    if (!items.length) return null;
    return { kind: 'list', title: 'Opening hours', items };
  }

  if (['packs', 'passes', 'prices', 'memberships', 'plans'].includes(src)) {
    const wantsMembership = src === 'memberships' || src === 'plans' || src === 'prices';
    const types = wantsMembership ? ['membership', 'class_pack'] : ['class_pack'];
    const products = siteId ? await loadProducts(siteId, types) : [];
    const items = products.map((p) => {
      const classes = Number(p.metadata?.classes ?? 0);
      const bits = [];
      if (classes === 1) bits.push('Single class');
      else if (classes > 1) bits.push(`${classes} sessions`);
      if (!bits.length && en(p.description)) bits.push(en(p.description));
      return {
        label: en(p.name),
        sublabel: bits.join(' · ') || undefined,
        meta: money(p.price_cents) ? `${money(p.price_cents)}${per(p.billing_interval)}` : undefined,
        // Somewhere to actually buy it. External tiers keep the owner's own URL.
        href: p.fulfillment_mode === 'external' && p.external_url
          ? p.external_url
          : PRODUCT_PAGE[p.product_type] || undefined,
      };
    });
    if (!items.length) return null;
    const onlyPacks = products.every((p) => p.product_type === 'class_pack');
    return { kind: 'list', title: onlyPacks ? 'Passes and packages' : 'Memberships and passes', items };
  }

  return null;
}

module.exports = { buildListCard };
