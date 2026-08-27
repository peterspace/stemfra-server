// CMS — owner suspends/unsuspends a member (hard account block). A suspended
// member can't book or use their portal actions; suspending also pauses their
// active subscription (billing stops). Suspend state lives in
// site_customers.metadata.suspended (no schema change). Single-var supabase require.
const supabase = require('../../config/supabase');
const { stripe } = require('../../config/stripe');
const { verifySiteOwnership } = require('../../middleware/cmsAuth');
const { logSiteActivity } = require('../../lib/activity');
const { sendReviewRequestManual } = require('../../lib/lifecycleEmails');

/** POST /api/cms/customers/:id/suspend  { suspend: boolean } */
async function setSuspended(req, res) {
  try {
    const { id } = req.params;
    const suspend = req.body?.suspend !== false; // default true
    const { data: cust } = await supabase
      .from('site_customers').select('id, site_id, email, metadata').eq('id', id).single();
    if (!cust) return res.status(404).json({ success: false, message: 'Member not found.' });
    const site = await verifySiteOwnership(req.cmsUser.id, cust.site_id);
    if (!site) return res.status(403).json({ success: false, message: 'Not your site.' });

    const md = { ...(cust.metadata || {}) };
    if (suspend) { md.suspended = true; md.suspended_at = new Date().toISOString(); }
    else { delete md.suspended; delete md.suspended_at; }
    await supabase.from('site_customers').update({ metadata: md }).eq('id', id);

    // Suspending also pauses any active subscription (billing stops). Unsuspending
    // does NOT auto-resume — the owner resumes deliberately.
    if (suspend && stripe) {
      const { data: subs } = await supabase
        .from('site_subscriptions').select('id, stripe_subscription_id, metadata')
        .eq('customer_id', id).not('stripe_subscription_id', 'is', null);
      for (const s of subs || []) {
        try {
          await stripe.subscriptions.update(s.stripe_subscription_id, { pause_collection: { behavior: 'void' } });
          await supabase.from('site_subscriptions').update({ metadata: { ...(s.metadata || {}), paused: true } }).eq('id', s.id);
        } catch (e) { console.warn('[suspend pause]', e.message); }
      }
    }

    await logSiteActivity({
      siteId: cust.site_id, actorName: req.cmsUser?.email,
      action: suspend ? 'member_suspended' : 'member_unsuspended',
      entityType: 'site_customer', entityId: id, entityName: cust.email,
    });
    res.json({ success: true, suspended: suspend });
  } catch (err) {
    console.error('[customers.setSuspended]', err.message);
    res.status(500).json({ success: false, message: 'Could not update member.' });
  }
}

/** POST /api/cms/customers/:id/send-review — owner manually sends the review
 *  request email to one client (Clients page kebab). Ownership-checked; the
 *  sender itself enforces opt-out + requires a visit + the configured link. */
async function sendReviewEmail(req, res) {
  try {
    const { id } = req.params;
    const { data: cust } = await supabase
      .from('site_customers').select('id, site_id, email').eq('id', id).single();
    if (!cust) return res.status(404).json({ success: false, message: 'Client not found.' });
    const site = await verifySiteOwnership(req.cmsUser.id, cust.site_id);
    if (!site) return res.status(403).json({ success: false, message: 'Not your site.' });

    const r = await sendReviewRequestManual(id);
    if (!r.ok) return res.status(400).json({ success: false, message: r.error });

    await logSiteActivity({
      siteId: cust.site_id, actorName: req.cmsUser?.email,
      action: 'review_request_sent_manual',
      entityType: 'site_customer', entityId: id, entityName: cust.email,
    });
    res.json({ success: true });
  } catch (err) {
    console.error('[customers.sendReview]', err.message);
    res.status(500).json({ success: false, message: 'Could not send the review request.' });
  }
}

// ─── Customer list / export / import (Task #25 — switcher toolkit) ───────────

// Lifetime revenue per customer (ROADMAP task 12, Peter 2026-08-04). Same basis
// as Reports v2: a booking counts once it is PAID online or the owner marked it
// COLLECTED at the visit (metadata.collected) — pending/due money is not
// "revenue from this client" yet. Deliberately NO fixed loyalty segments
// (VIP/lapsed etc. — thresholds don't transfer across verticals); the owner
// filters by a number instead. JS aggregation over one capped fetch, same
// tradeoff as the site monitor: fine at tenant scale, move to SQL group-by at
// platform scale.
async function revenueByCustomer(siteId) {
  const { data, error } = await supabase
    .from('site_bookings')
    .select('customer_id, amount_cents, payment_status, metadata')
    .eq('site_id', siteId)
    .gt('amount_cents', 0)
    .limit(50000);
  if (error) throw error;
  const out = new Map();
  for (const b of data || []) {
    if (!b.customer_id) continue;
    const counts = b.payment_status === 'paid' || b.metadata?.collected === true;
    if (!counts) continue;
    out.set(b.customer_id, (out.get(b.customer_id) || 0) + (b.amount_cents || 0));
  }
  return out;
}

// GET /api/cms/customers?siteId= — the site's customer book (newest-active first).
async function listCustomers(req, res) {
  try {
    const siteId = req.query?.siteId;
    if (!siteId) return res.status(400).json({ success: false, message: 'Missing siteId.' });
    const site = await verifySiteOwnership(req.cmsUser.id, siteId);
    if (!site) return res.status(403).json({ success: false, message: 'Not your site.' });

    const { data, error } = await supabase
      .from('site_customers')
      .select('id, first_name, last_name, email, phone, birthdate, tags, notes, email_opt_out, sms_opt_in, total_bookings, last_booked_at, created_at, metadata')
      .eq('site_id', siteId)
      .order('last_booked_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(5000);
    if (error) throw error;
    const revenue = await revenueByCustomer(siteId);

    const customers = (data || []).map((c) => ({
      id: c.id,
      firstName: c.first_name, lastName: c.last_name,
      email: c.email, phone: c.phone, birthdate: c.birthdate,
      tags: c.tags || [], notes: c.notes,
      emailOptOut: c.email_opt_out, smsOptIn: c.sms_opt_in,
      totalBookings: c.total_bookings, lastBookedAt: c.last_booked_at, createdAt: c.created_at,
      suspended: c.metadata?.suspended === true,
      lifetimeRevenueCents: revenue.get(c.id) || 0,
    }));
    res.json({ success: true, customers });
  } catch (err) {
    console.error('[customers.list]', err.message);
    res.status(500).json({ success: false, message: 'Could not load customers.' });
  }
}

function csvCell(v) {
  if (v == null) return '';
  const s = Array.isArray(v) ? v.join('; ') : String(v);
  // Quote if it contains a comma, quote, or newline; escape embedded quotes.
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// GET /api/cms/customers/export?siteId= — download the customer book as CSV.
async function exportCustomers(req, res) {
  try {
    const siteId = req.query?.siteId;
    if (!siteId) return res.status(400).send('Missing siteId.');
    const site = await verifySiteOwnership(req.cmsUser.id, siteId);
    if (!site) return res.status(403).send('Not your site.');

    const { data, error } = await supabase
      .from('site_customers')
      .select('id, first_name, last_name, email, phone, birthdate, tags, notes, email_opt_out, sms_opt_in, total_bookings, last_booked_at, created_at')
      .eq('site_id', siteId)
      .order('created_at', { ascending: false })
      .limit(50000);
    if (error) throw error;
    const revenue = await revenueByCustomer(siteId);

    const cols = ['First name', 'Last name', 'Email', 'Phone', 'Birthdate', 'Tags', 'Notes', 'Email opt-out', 'SMS opt-in', 'Total bookings', 'Lifetime revenue', 'Last booked', 'Added'];
    const lines = [cols.join(',')];
    for (const c of data || []) {
      lines.push([
        c.first_name, c.last_name, c.email, c.phone, c.birthdate, c.tags, c.notes,
        c.email_opt_out ? 'yes' : 'no', c.sms_opt_in ? 'yes' : 'no',
        c.total_bookings, ((revenue.get(c.id) || 0) / 100).toFixed(2),
        c.last_booked_at ? String(c.last_booked_at).slice(0, 10) : '', String(c.created_at).slice(0, 10),
      ].map(csvCell).join(','));
    }
    const fname = `${site.subdomain || 'customers'}-customers-${new Date().toISOString().slice(0, 10)}.csv`;
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${fname}"`);
    res.send('﻿' + lines.join('\r\n')); // BOM so Excel reads UTF-8
  } catch (err) {
    console.error('[customers.export]', err.message);
    res.status(500).send('Could not export.');
  }
}

// Normalize an incoming mapped row → a clean customer shape (or null if unusable).
const normEmail = (e) => (typeof e === 'string' ? e.trim().toLowerCase() : '');
const normPhoneKey = (p) => (typeof p === 'string' ? p.replace(/[^\d]/g, '') : '');
const looksEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

function cleanRow(raw) {
  const email = normEmail(raw.email);
  const phone = (raw.phone || '').toString().trim();
  const phoneKey = normPhoneKey(phone);
  // Need at least a usable email or a phone with enough digits to be real.
  const hasEmail = email && looksEmail(email);
  const hasPhone = phoneKey.length >= 7;
  if (!hasEmail && !hasPhone) return { skip: 'no_contact' };

  let birthdate = null;
  if (raw.birthdate) {
    const d = new Date(raw.birthdate);
    if (!isNaN(d.getTime())) birthdate = d.toISOString().slice(0, 10);
  }
  const tags = Array.isArray(raw.tags)
    ? raw.tags
    : (typeof raw.tags === 'string' && raw.tags.trim() ? raw.tags.split(/[;,]/).map((t) => t.trim()).filter(Boolean) : []);

  const truthy = (v) => v === true || /^(1|true|yes|y)$/i.test(String(v ?? '').trim());
  return {
    firstName: (raw.firstName || '').toString().trim() || null,
    lastName: (raw.lastName || '').toString().trim() || null,
    email: hasEmail ? email : null,
    phone: phone || null,
    phoneKey,
    birthdate,
    notes: (raw.notes || '').toString().trim() || null,
    tags,
    emailOptOut: truthy(raw.emailOptOut),
    smsOptIn: truthy(raw.smsOptIn),
  };
}

// Load existing customers for dedup + build email/phone → id lookups.
async function loadDedup(siteId) {
  const { data } = await supabase
    .from('site_customers').select('id, email, phone, first_name, last_name, birthdate, notes, tags')
    .eq('site_id', siteId).limit(100000);
  const byEmail = new Map(), byPhone = new Map(), byId = new Map();
  for (const c of data || []) {
    byId.set(c.id, c);
    if (c.email) byEmail.set(normEmail(c.email), c.id);
    const pk = normPhoneKey(c.phone);
    if (pk.length >= 7) byPhone.set(pk, c.id);
  }
  return { byEmail, byPhone, byId };
}

// Classify the incoming rows against existing customers + within the batch itself.
// Returns { rows: [{clean, action:'create'|'merge'|'skip', reason?, existingId?}], counts }.
async function classify(siteId, rawRows) {
  const { byEmail, byPhone, byId } = await loadDedup(siteId);
  const seenEmail = new Set(), seenPhone = new Set();
  let toCreate = 0, toMerge = 0, toSkip = 0;
  const rows = [];

  for (const raw of rawRows || []) {
    const c = cleanRow(raw || {});
    if (c.skip) { toSkip++; rows.push({ action: 'skip', reason: c.skip }); continue; }

    // Within-file dedup (same contact twice in the CSV → import once).
    if ((c.email && seenEmail.has(c.email)) || (c.phoneKey && seenPhone.has(c.phoneKey))) {
      toSkip++; rows.push({ action: 'skip', reason: 'duplicate_in_file' }); continue;
    }
    if (c.email) seenEmail.add(c.email);
    if (c.phoneKey) seenPhone.add(c.phoneKey);

    const existingId = (c.email && byEmail.get(c.email)) || (c.phoneKey && byPhone.get(c.phoneKey)) || null;
    if (existingId) { toMerge++; rows.push({ action: 'merge', clean: c, existingId, existing: byId.get(existingId) }); }
    else { toCreate++; rows.push({ action: 'create', clean: c }); }
  }
  return { rows, counts: { total: (rawRows || []).length, toCreate, toMerge, toSkip } };
}

// POST /api/cms/customers/import/preview  { siteId, rows } — dry run (no writes).

// ─── Import column mapping: provider presets first, AI fallback ────────────
// (Plan of record: stemfra_platform/docs/ANALYTICS_AND_IMPORTS_PLAN.md.)
// The LLM only ever makes the MAPPING DECISION — it sees headers plus a few
// MASKED sample values, never the dataset; plain code transforms every row.
const OpenAI = require('openai');
const importAi = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const IMPORT_MAP_MODEL = process.env.IMPORT_MAP_MODEL || 'gpt-4o-mini';

const IMPORT_FIELD_KEYS = ['firstName', 'lastName', 'email', 'phone', 'birthdate', 'tags', 'notes', 'smsOptIn', 'emailOptOut'];

// Known export layouts (lowercase headers). Signature = headers that identify
// the provider; map = header → our field. Refined as real exports come in.
const IMPORT_PRESETS = [
  {
    name: 'Mindbody',
    signature: ['first name', 'last name', 'email', 'mobile phone', 'birth date'],
    minMatch: 4,
    map: {
      'first name': 'firstName', 'last name': 'lastName', 'email': 'email',
      'mobile phone': 'phone', 'home phone': null, 'work phone': null,
      'birth date': 'birthdate', 'birthday': 'birthdate', 'client id': null,
      'notes': 'notes', 'tags': 'tags', 'liability release': null,
    },
  },
  {
    name: 'Square',
    signature: ['first name', 'surname', 'email address', 'phone number'],
    minMatch: 3,
    map: {
      'first name': 'firstName', 'surname': 'lastName', 'last name': 'lastName',
      'email address': 'email', 'phone number': 'phone', 'birthday': 'birthdate',
      'memo': 'notes', 'groups': 'tags', 'email subscription status': null,
    },
  },
  {
    name: 'Vagaro',
    signature: ['first name', 'last name', 'mobile', 'email'],
    minMatch: 4,
    map: {
      'first name': 'firstName', 'last name': 'lastName', 'email': 'email',
      'mobile': 'phone', 'day phone': null, 'birthday': 'birthdate',
      'customer notes': 'notes', 'tags': 'tags',
    },
  },
  {
    name: 'Acuity / Squarespace',
    signature: ['first name', 'last name', 'phone', 'email', 'notes'],
    minMatch: 4,
    map: {
      'first name': 'firstName', 'last name': 'lastName', 'email': 'email',
      'phone': 'phone', 'notes': 'notes',
    },
  },
  {
    name: 'Booksy',
    signature: ['first name', 'last name', 'e-mail', 'phone'],
    minMatch: 3,
    map: {
      'first name': 'firstName', 'last name': 'lastName', 'e-mail': 'email',
      'phone': 'phone', 'birth date': 'birthdate', 'note': 'notes',
    },
  },
];

function matchImportPreset(headers) {
  const lower = headers.map(h => String(h || '').toLowerCase().trim());
  for (const preset of IMPORT_PRESETS) {
    const hits = preset.signature.filter(sig => lower.includes(sig)).length;
    if (hits >= preset.minMatch) {
      const map = {};
      headers.forEach((h, i) => {
        const key = preset.map[lower[i]];
        map[h] = key === undefined ? null : key;
      });
      return { name: preset.name, map };
    }
  }
  return null;
}

/** Mask a sample so structure survives but PII does not: digits → #, letters
 *  after the first two of each token → x; email domains stay readable. */
function maskSample(v) {
  const str = String(v ?? '').slice(0, 48);
  const at = str.indexOf('@');
  if (at > 0) return `${maskSample(str.slice(0, at))}@${str.slice(at + 1)}`;
  let letters = 0;
  return str.replace(/[0-9]/g, '#').replace(/[A-Za-z]/g, (c) => (letters++ < 2 ? c : 'x'));
}

async function aiMapColumns(headers, samples) {
  if (!importAi) return null;
  const lines = headers.map(h => {
    const vals = (samples?.[h] ?? []).slice(0, 3).map(maskSample).filter(Boolean);
    return `- "${h}"${vals.length ? ` (masked samples: ${vals.join(' | ')})` : ''}`;
  });
  const completion = await importAi.chat.completions.create({
    model: IMPORT_MAP_MODEL,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: [
          'You map spreadsheet columns from a local-business client export onto a fixed set of customer fields.',
          `Allowed field values: ${IMPORT_FIELD_KEYS.join(', ')}, or null for columns that should not be imported (ids, addresses, spend history, appointment data, marketing stats).`,
          'smsOptIn/emailOptOut are consent flags; only map clearly-labeled consent columns. Sample values are masked (digits are #, most letters are x) but keep their structure.',
          'Each field may be used at most once. Return ONLY JSON: { "map": { "<exact header>": "<field or null>", ... } } covering every header.',
        ].join('\n'),
      },
      { role: 'user', content: `Columns:\n${lines.join('\n')}` },
    ],
  });
  const parsed = JSON.parse(completion.choices[0]?.message?.content ?? '{}');
  const raw = parsed.map || {};
  const used = new Set();
  const map = {};
  for (const h of headers) {
    const key = raw[h];
    if (IMPORT_FIELD_KEYS.includes(key) && !used.has(key)) { map[h] = key; used.add(key); }
    else map[h] = null;
  }
  return map;
}

/** Shared mapping core (CMS owner route + CRM staff route). */
async function resolveColumnMap(headers, samples) {
  const preset = matchImportPreset(headers);
  if (preset) return { source: 'preset', presetName: preset.name, map: preset.map };
  try {
    const aiMap = await aiMapColumns(headers, samples);
    if (aiMap) return { source: 'ai', map: aiMap };
  } catch (err) {
    console.error('[customers.resolveColumnMap] AI mapping failed:', err.message);
  }
  // No preset, no AI: the client falls back to its local heuristic.
  return { source: 'none', map: null };
}

// POST /api/cms/customers/import/map  { siteId, headers, samples } →
// { source: 'preset'|'ai'|'none', presetName?, map }
async function mapImportColumns(req, res) {
  try {
    const { siteId, headers, samples } = req.body || {};
    if (!siteId || !Array.isArray(headers) || !headers.length || headers.length > 120) {
      return res.status(400).json({ success: false, message: 'Missing siteId or headers.' });
    }
    const site = await verifySiteOwnership(req.cmsUser.id, siteId);
    if (!site) return res.status(403).json({ success: false, message: 'Not your site.' });
    res.json({ success: true, ...(await resolveColumnMap(headers, samples)) });
  } catch (err) {
    console.error('[customers.mapImportColumns]', err.message);
    res.status(500).json({ success: false, message: 'Could not match the columns.' });
  }
}

async function importPreview(req, res) {
  try {
    const { siteId, rows } = req.body || {};
    if (!siteId || !Array.isArray(rows)) return res.status(400).json({ success: false, message: 'Missing siteId or rows.' });
    if (rows.length > 20000) return res.status(413).json({ success: false, message: 'That file is too large — split it into batches of 20,000 or fewer.' });
    const site = await verifySiteOwnership(req.cmsUser.id, siteId);
    if (!site) return res.status(403).json({ success: false, message: 'Not your site.' });

    const { counts } = await classify(siteId, rows);
    res.json({ success: true, ...counts });
  } catch (err) {
    console.error('[customers.importPreview]', err.message);
    res.status(500).json({ success: false, message: 'Could not preview the import.' });
  }
}

// POST /api/cms/customers/import  { siteId, rows } — performs the import.
// Creates new customers; MERGES existing ones conservatively (fills only blank
// fields + unions tags — never overwrites data the owner already has). Opt-OUT
// is honored if set (suppression is always safe); opt-IN is written as given
// (the owner asserts they hold consent for their own migrated client base).
async function importCustomers(req, res) {
  try {
    const { siteId, rows } = req.body || {};
    if (!siteId || !Array.isArray(rows)) return res.status(400).json({ success: false, message: 'Missing siteId or rows.' });
    if (rows.length > 20000) return res.status(413).json({ success: false, message: 'That file is too large — split it into batches of 20,000 or fewer.' });
    const site = await verifySiteOwnership(req.cmsUser.id, siteId);
    if (!site) return res.status(403).json({ success: false, message: 'Not your site.' });
    const result = await runImport(siteId, rows, req.cmsUser?.email, site.subdomain);
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('[customers.import]', err.message);
    res.status(500).json({ success: false, message: 'Could not import. No partial data was left behind for the failed batch.' });
  }
}

/** Shared import core (CMS owner route + CRM staff route). */
async function runImport(siteId, rows, actorEmail, siteSubdomain) {
  {
    const { rows: classified } = await classify(siteId, rows);

    // New customers → batch insert.
    const inserts = classified.filter((r) => r.action === 'create').map((r) => ({
      site_id: siteId,
      first_name: r.clean.firstName, last_name: r.clean.lastName,
      email: r.clean.email, phone: r.clean.phone, birthdate: r.clean.birthdate,
      notes: r.clean.notes, tags: r.clean.tags,
      email_opt_out: r.clean.emailOptOut, sms_opt_in: r.clean.smsOptIn,
      metadata: { imported_at: new Date().toISOString() },
    }));
    let created = 0;
    for (let i = 0; i < inserts.length; i += 500) {
      const chunk = inserts.slice(i, i + 500);
      const { error } = await supabase.from('site_customers').insert(chunk);
      if (error) throw error;
      created += chunk.length;
    }

    // Existing customers → conservative merge (fill blanks + union tags only).
    let merged = 0;
    for (const r of classified.filter((x) => x.action === 'merge')) {
      const ex = r.existing || {};
      const patch = {};
      if (!ex.first_name && r.clean.firstName) patch.first_name = r.clean.firstName;
      if (!ex.last_name && r.clean.lastName) patch.last_name = r.clean.lastName;
      if (!ex.email && r.clean.email) patch.email = r.clean.email;
      if (!ex.phone && r.clean.phone) patch.phone = r.clean.phone;
      if (!ex.birthdate && r.clean.birthdate) patch.birthdate = r.clean.birthdate;
      if (!ex.notes && r.clean.notes) patch.notes = r.clean.notes;
      const exTags = ex.tags || [];
      const union = [...new Set([...exTags, ...r.clean.tags])];
      if (union.length > exTags.length) patch.tags = union;
      if (r.clean.emailOptOut) patch.email_opt_out = true; // honor suppression, never un-suppress
      if (Object.keys(patch).length) {
        const { error } = await supabase.from('site_customers').update(patch).eq('id', r.existingId).eq('site_id', siteId);
        if (!error) merged++;
      } else {
        merged++; // matched an existing record with nothing new to add — still "handled"
      }
    }

    const skipped = classified.filter((r) => r.action === 'skip').length;
    await logSiteActivity({
      siteId, actorName: actorEmail, action: 'customers_imported',
      entityType: 'site', entityId: siteId, entityName: siteSubdomain,
      details: { created, merged, skipped },
    });
    return { created, merged, skipped };
  }
}

// ─── Staff (CRM) variants: same cores, staff auth, any site ────────────────
// The high-touch onboarding path — staff run the migration on a client's
// behalf. Auth = requireStaffRole in routes/admin/customerImport.js; the site
// just has to exist.
async function loadSiteById(siteId) {
  const { data } = await supabase.from('sites').select('id, subdomain').eq('id', siteId).maybeSingle();
  return data;
}

async function adminMapImportColumns(req, res) {
  try {
    const { siteId, headers, samples } = req.body || {};
    if (!siteId || !Array.isArray(headers) || !headers.length || headers.length > 120) {
      return res.status(400).json({ success: false, message: 'Missing siteId or headers.' });
    }
    const site = await loadSiteById(siteId);
    if (!site) return res.status(404).json({ success: false, message: 'Site not found.' });
    res.json({ success: true, ...(await resolveColumnMap(headers, samples)) });
  } catch (err) {
    console.error('[admin.customerImport.map]', err.message);
    res.status(500).json({ success: false, message: 'Could not match the columns.' });
  }
}

async function adminImportPreview(req, res) {
  try {
    const { siteId, rows } = req.body || {};
    if (!siteId || !Array.isArray(rows)) return res.status(400).json({ success: false, message: 'Missing siteId or rows.' });
    if (rows.length > 20000) return res.status(413).json({ success: false, message: 'That file is too large. Split it into batches of 20,000 or fewer.' });
    const site = await loadSiteById(siteId);
    if (!site) return res.status(404).json({ success: false, message: 'Site not found.' });
    const { counts } = await classify(siteId, rows);
    res.json({ success: true, ...counts });
  } catch (err) {
    console.error('[admin.customerImport.preview]', err.message);
    res.status(500).json({ success: false, message: 'Could not preview the import.' });
  }
}

async function adminImportCustomers(req, res) {
  try {
    const { siteId, rows } = req.body || {};
    if (!siteId || !Array.isArray(rows)) return res.status(400).json({ success: false, message: 'Missing siteId or rows.' });
    if (rows.length > 20000) return res.status(413).json({ success: false, message: 'That file is too large. Split it into batches of 20,000 or fewer.' });
    const site = await loadSiteById(siteId);
    if (!site) return res.status(404).json({ success: false, message: 'Site not found.' });
    const result = await runImport(siteId, rows, req.staffUser?.email, site.subdomain);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[admin.customerImport]', err.message);
    res.status(500).json({ success: false, message: 'Could not import. No partial data was left behind for the failed batch.' });
  }
}

/** POST /api/cms/customers/announce — { siteId, dryRun? }. The website
 *  announcement blast (Client Growth Engine build 1): every not-yet-announced
 *  client with an email gets the "we have a new website" email once. dryRun
 *  returns the pending count so the CMS can show "Send to N clients". */
async function announceCustomers(req, res) {
  try {
    const { siteId, dryRun } = req.body || {};
    if (!siteId) return res.status(400).json({ success: false, message: 'siteId is required.' });
    const site = await verifySiteOwnership(req.cmsUser.id, siteId);
    if (!site) return res.status(403).json({ success: false, message: 'Not your site.' });

    const { sendWebsiteAnnouncement } = require('../../lib/announcementEmail');
    const r = await sendWebsiteAnnouncement(siteId, { dryRun: !!dryRun });
    if (!r.ok) return res.status(400).json({ success: false, message: r.error });
    if (!dryRun && r.sent) {
      await logSiteActivity({
        siteId, actorName: req.cmsUser?.email,
        action: 'website_announcement_sent',
        entityType: 'site', entityId: siteId,
        details: { sent: r.sent, failed: r.failed, remaining: r.remaining },
      });
    }
    res.json({ success: true, ...r });
  } catch (err) {
    console.error('[customers.announce]', err.message);
    res.status(500).json({ success: false, message: 'Could not send the announcement.' });
  }
}

module.exports = {
  mapImportColumns, setSuspended, sendReviewEmail, listCustomers, exportCustomers, importPreview, importCustomers,
  announceCustomers,
  adminMapImportColumns, adminImportPreview, adminImportCustomers };
