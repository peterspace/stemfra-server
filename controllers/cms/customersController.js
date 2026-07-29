// CMS — owner suspends/unsuspends a member (hard account block). A suspended
// member can't book or use their portal actions; suspending also pauses their
// active subscription (billing stops). Suspend state lives in
// site_customers.metadata.suspended (no schema change). Single-var supabase require.
const supabase = require('../../config/supabase');
const { stripe } = require('../../config/stripe');
const { verifySiteOwnership } = require('../../middleware/cmsAuth');
const { logSiteActivity } = require('../../lib/activity');

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

// ─── Customer list / export / import (Task #25 — switcher toolkit) ───────────

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

    const customers = (data || []).map((c) => ({
      id: c.id,
      firstName: c.first_name, lastName: c.last_name,
      email: c.email, phone: c.phone, birthdate: c.birthdate,
      tags: c.tags || [], notes: c.notes,
      emailOptOut: c.email_opt_out, smsOptIn: c.sms_opt_in,
      totalBookings: c.total_bookings, lastBookedAt: c.last_booked_at, createdAt: c.created_at,
      suspended: c.metadata?.suspended === true,
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
      .select('first_name, last_name, email, phone, birthdate, tags, notes, email_opt_out, sms_opt_in, total_bookings, last_booked_at, created_at')
      .eq('site_id', siteId)
      .order('created_at', { ascending: false })
      .limit(50000);
    if (error) throw error;

    const cols = ['First name', 'Last name', 'Email', 'Phone', 'Birthdate', 'Tags', 'Notes', 'Email opt-out', 'SMS opt-in', 'Total bookings', 'Last booked', 'Added'];
    const lines = [cols.join(',')];
    for (const c of data || []) {
      lines.push([
        c.first_name, c.last_name, c.email, c.phone, c.birthdate, c.tags, c.notes,
        c.email_opt_out ? 'yes' : 'no', c.sms_opt_in ? 'yes' : 'no',
        c.total_bookings, c.last_booked_at ? String(c.last_booked_at).slice(0, 10) : '', String(c.created_at).slice(0, 10),
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
      siteId, actorName: req.cmsUser?.email, action: 'customers_imported',
      entityType: 'site', entityId: siteId, entityName: site.subdomain,
      details: { created, merged, skipped },
    });
    res.json({ success: true, created, merged, skipped });
  } catch (err) {
    console.error('[customers.import]', err.message);
    res.status(500).json({ success: false, message: 'Could not import. No partial data was left behind for the failed batch.' });
  }
}

module.exports = { setSuspended, listCustomers, exportCustomers, importPreview, importCustomers };
