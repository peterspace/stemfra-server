// Provision Stemfra demo sites — one per active theme, owned by the single
// "Mark / Stemfra Demos" contact. Reuses the proven libs (provisionSite +
// attachSiteDomain). For each spec: ensure a business company → provisionSite
// (seed clone with the chosen theme) → rename the seed brand in the cloned
// content → attach {subdomain}.stemfra.com → publish live. Resumable: a spec
// whose company already has a site is finished in place (rename/attach/publish
// are idempotent). See docs/DEMOS.md for the full picture + the owner IDs.
//
// Run from the server dir:
//   NODE_PATH=$PWD/node_modules node scripts/provision-demos.js [startIndex] [count]
require('dotenv').config();
const supabase = require('../config/supabase');
const { provisionSite } = require('../lib/provisionSite');
const { attachSiteDomain } = require('../lib/attachSiteDomain');

// Owner contact "Mark — Stemfra" (Stemfra Demos). See docs/DEMOS.md.
const MARK_CONTACT = '2cdcfe53-0117-45da-a447-7d60ee0a6236';

// Seed brand strings to replace in each clone. full = always safe; short = a
// distinctive standalone token (else null); slug = the email-domain form
// (hello@{slug}.com) — replaced for email, NEVER the Cloudinary "{slug}/" path.
const SEED_BRAND = {
  barbershops:  { full: 'Argyle & Sons', short: 'Argyle', slug: 'argyle-and-sons' },
  salons:       { full: 'Maison Lune',   short: null,     slug: 'maison-lune' },
  crossfit:     { full: 'Forge & Bell',  short: null,     slug: 'forge-and-bell' },
  yoga_pilates: { full: 'Lila Studio',   short: 'Lila',   slug: 'lila-studio' },
};

// One demo per ACTIVE theme across the 4 live verticals (boutique gyms deferred).
const DEMOS = [
  { vertical: 'barbershops',  templateSlug: 'barbershops-manhattan',  name: 'Rourke & Sloane',           short: 'Rourke',     city: 'New York' },
  { vertical: 'barbershops',  templateSlug: 'barbershops-classic-nyc',name: 'Halsey & Crowe',            short: 'Halsey',     city: 'New York' },
  { vertical: 'salons',       templateSlug: 'salons-sorrel',          name: 'Linden & Lark',             short: null,         city: 'Los Angeles' },
  { vertical: 'salons',       templateSlug: 'salons-beauty-house',    name: 'Vesper Beauty House',       short: null,         city: 'Miami' },
  { vertical: 'crossfit',     templateSlug: 'crossfit-box',           name: 'Ironclad Athletics',        short: null,         city: 'Austin' },
  { vertical: 'crossfit',     templateSlug: 'crossfit-volt',          name: 'Voltage Strength',          short: null,         city: 'Denver' },
  { vertical: 'crossfit',     templateSlug: 'crossfit-blackfly',      name: 'Blackfly Barbell',          short: null,         city: 'Chicago' },
  { vertical: 'crossfit',     templateSlug: 'crossfit-212',           name: '212 Strength Co.',          short: null,         city: 'Brooklyn' },
  { vertical: 'yoga_pilates', templateSlug: 'yoga-pilates-sanctuary', name: 'Wildflower Yoga + Pilates', short: 'Wildflower', city: 'Portland' },
];

const replaceAll = (str, from, to) => (from ? str.split(from).join(to) : str);

async function renameBrand(siteId, vertical, spec, subdomain) {
  const seed = SEED_BRAND[vertical];
  if (!seed) return 0;
  const applyStr = (s) => {
    let out = replaceAll(s, seed.full, spec.name);
    if (seed.short && spec.short) out = replaceAll(out, seed.short, spec.short);
    out = replaceAll(out, `${seed.slug}.com`, `${subdomain}.com`); // email domain only
    return out;
  };
  const applyValue = (v) => {
    if (v == null) return v;
    if (typeof v === 'string') return applyStr(v);
    return JSON.parse(applyStr(JSON.stringify(v))); // jsonb columns
  };
  const renameCol = async (table, col) => {
    const { data: rows } = await supabase.from(table).select(`id, ${col}`).eq('site_id', siteId);
    for (const row of rows || []) {
      const before = JSON.stringify(row[col] ?? null);
      const next = applyValue(row[col]);
      if (JSON.stringify(next ?? null) !== before) {
        await supabase.from(table).update({ [col]: next }).eq('id', row.id);
      }
    }
  };
  await renameCol('site_sections', 'content');
  await renameCol('site_team_members', 'bio');
  const { data: resid } = await supabase.from('site_sections').select('id, content').eq('site_id', siteId);
  return (resid || []).filter((r) => {
    const t = JSON.stringify(r.content ?? '');
    return t.includes(seed.full) || t.includes(`${seed.slug}.com`);
  }).length;
}

async function ensureCompany(name) {
  const { data: existing } = await supabase.from('companies').select('id').eq('name', name).maybeSingle();
  if (existing) return existing.id;
  const { data, error } = await supabase.from('companies').insert({ name }).select('id').single();
  if (error) throw new Error(`company insert: ${error.message}`);
  return data.id;
}

async function provisionOne(spec) {
  const companyId = await ensureCompany(spec.name);
  let siteId, subdomain;
  const { data: s } = await supabase.from('sites').select('id, subdomain').eq('company_id', companyId).maybeSingle();
  if (s) { siteId = s.id; subdomain = s.subdomain; }
  else {
    const r = await provisionSite({
      vertical: spec.vertical, companyId, ownerContactId: MARK_CONTACT,
      displayName: spec.name, city: spec.city, templateSlug: spec.templateSlug,
    });
    siteId = r.siteId; subdomain = r.subdomain;
  }
  const residual = await renameBrand(siteId, spec.vertical, spec, subdomain);
  let domainStatus;
  try { domainStatus = (await attachSiteDomain(siteId))?.domainStatus || 'attached'; }
  catch (e) { domainStatus = `attach-skip: ${e.message.slice(0, 60)}`; }
  await supabase.from('sites').update({ status: 'live', went_live_at: new Date().toISOString() }).eq('id', siteId);
  return { name: spec.name, vertical: spec.vertical, template: spec.templateSlug, siteId, subdomain, url: `https://${subdomain}.stemfra.com`, residualOldBrand: residual, domainStatus };
}

(async () => {
  const start = parseInt(process.argv[2] || '0', 10);
  const count = parseInt(process.argv[3] || String(DEMOS.length), 10);
  const out = [];
  for (const spec of DEMOS.slice(start, start + count)) {
    try { out.push(await provisionOne(spec)); }
    catch (e) { out.push({ name: spec.name, error: e.message }); }
  }
  console.log(JSON.stringify(out, null, 2));
})();
