// Media localization — make a site own every Cloudinary asset it references.
//
// WHY: cloneSite/provisionSite copy content verbatim, so a cloned site's pages
// keep pointing at the SOURCE site's Cloudinary files (folder = the source's
// subdomain). That shares one physical asset across sites: deleting it from the
// source's Media library silently breaks every clone (the per-site "In use"
// scan can't see cross-site usage), and per-customer folder bulk-delete becomes
// unsafe. Found fleet-wide on the demo sites 2026-07-09.
//
// WHAT: scan every media-bearing surface of a site, find references whose
// Cloudinary folder is NOT the site's own, copy each asset into the site's
// folder (+ a site_media row), and rewrite the references in place. Images are
// normalized on the way (capped WebP — same rule as the CMS upload path);
// videos copy as-is. Idempotent: a second run finds nothing foreign.
//
// USED BY: cloneSite + provisionSite (fire-and-forget after the clone commits,
// so provisioning latency doesn't grow by N Cloudinary copies) and the one-time
// fleet backfill script.
const { randomUUID } = require('crypto');
const supabase = require('../config/supabase'); // service-role; single-var require
const { cloudinary, isCloudinaryConfigured } = require('../config/cloudinary');

const MAX_IMAGE_DIMENSION = 2560; // keep in sync with controllers/cms/uploadController.js

// Every table+column that can carry a media URL or a site_media id. JSONB
// columns are rewritten shape-agnostically (serialize → replace → parse), so
// nested shapes (gallery images[], category_cards[], strip_images, hero video
// lists, …) are all covered without enumerating them.
const SURFACES = [
  { table: 'site_sections', cols: ['content', 'metadata'] },
  { table: 'site_services', cols: ['photo_url', 'photo_media_id', 'metadata'] },
  { table: 'site_team_members', cols: ['photo_url', 'photo_media_id', 'metadata'] },
  { table: 'site_testimonials', cols: ['author_photo_url', 'author_photo_media_id', 'metadata'] },
  { table: 'site_theme_settings', cols: ['logo_url', 'favicon_url', 'social_share_image_url', 'metadata'] },
  { table: 'site_pages', cols: ['og_image_url', 'metadata'] },
  { table: 'site_posts', cols: ['cover_image_url', 'cover_image_media_id', 'metadata'] },
];

const CLD_RE = /res\.cloudinary\.com\/([a-z0-9_-]+)\/(image|video)\/upload\/([^"'\s\\)]+)/g;
// External stock-photo URLs (Unsplash) — ingested when `includeExternal` is on
// so a site's imagery has no third-party hotlink dependencies.
const EXTERNAL_RE = /https:\/\/images\.unsplash\.com\/[^"'\s\\)]+/g;

/** Parse a Cloudinary upload path into { folder, file, ext } — dropping
 *  transformation segments (contain ',' or '_' key-value pairs) and the
 *  version segment. Legacy `sites/<uuid>/<hash>` folders come back intact. */
function parsePath(path) {
  const clean = path.split('?')[0];
  const segs = clean.split('/').filter((s) => s && !/^v\d+$/.test(s) && !s.includes(','));
  if (segs.length < 2) return null;
  const last = segs[segs.length - 1];
  const m = last.match(/^(.+)\.([a-z0-9]+)$/i);
  if (!m) return null;
  return { folder: segs.slice(0, -1).join('/'), file: m[1], ext: m[2].toLowerCase() };
}

function serializeCol(val) {
  if (val === null || val === undefined) return null;
  return typeof val === 'string' ? val : JSON.stringify(val);
}

/**
 * Localize one site's media. Returns a summary:
 * { siteId, subdomain, copied, rewrittenRows, skipped, assets: [{from, to}] }
 * With { dryRun: true } it only reports what WOULD be copied (assets[].from).
 * With { includeExternal: true } it ALSO ingests external stock URLs (Unsplash)
 * into the site's Cloudinary folder — no third-party hotlinks left behind.
 */
async function localizeSiteMedia(siteId, { dryRun = false, includeExternal = false } = {}) {
  if (!isCloudinaryConfigured()) throw new Error('Cloudinary is not configured');

  const { data: site, error: siteErr } = await supabase
    .from('sites').select('id, subdomain').eq('id', siteId).single();
  if (siteErr || !site) throw new Error(`site ${siteId} not found: ${siteErr?.message}`);

  const isForeign = (folder) =>
    folder !== site.subdomain &&
    folder !== `sites/${siteId}` &&
    !folder.startsWith('stemfra_assets');

  // 1. Fetch all surface rows + collect distinct foreign references.
  const rowsByTable = {};
  const foreign = new Map(); // key `${rtype}:${folder}/${file}.${ext}` → {rtype, folder, file, ext}
  for (const s of SURFACES) {
    const { data, error } = await supabase.from(s.table).select('*').eq('site_id', siteId);
    if (error) throw new Error(`fetch ${s.table}: ${error.message}`);
    rowsByTable[s.table] = data || [];
    for (const row of rowsByTable[s.table]) {
      for (const col of s.cols) {
        const text = serializeCol(row[col]);
        if (!text) continue;
        for (const m of text.matchAll(CLD_RE)) {
          const parsed = parsePath(m[3]);
          if (parsed && isForeign(parsed.folder)) {
            foreign.set(`${m[2]}:${parsed.folder}/${parsed.file}.${parsed.ext}`, { rtype: m[2], ...parsed });
          }
        }
        if (includeExternal) {
          for (const m of text.matchAll(EXTERNAL_RE)) {
            foreign.set(`ext:${m[0]}`, { external: true, url: m[0] });
          }
        }
      }
    }
  }

  if (foreign.size === 0 || dryRun) {
    return {
      siteId, subdomain: site.subdomain, copied: 0, rewrittenRows: 0, skipped: 0,
      assets: [...foreign.values()].map((r) => ({
        from: r.external ? r.url : `${r.folder}/${r.file}.${r.ext}`,
        to: dryRun ? '(dry run)' : null,
      })),
    };
  }

  // 2. Copy each foreign asset into this site's folder (+ site_media row).
  //    Build the replacement pairs: `${oldKey}.${ext}`→`${newKey}.${newExt}`,
  //    bare `${oldKey}`→`${newKey}`, and source-media-row id → new row id.
  const cloud = cloudinary.config().cloud_name;
  const replacements = []; // [from, to] — applied longest-first
  let copied = 0;
  let skipped = 0;
  const assetLog = [];

  for (const ref of foreign.values()) {
    const oldKey = ref.external ? null : `${ref.folder}/${ref.file}`;
    const sourceUrl = ref.external
      ? ref.url
      : `https://res.cloudinary.com/${cloud}/${ref.rtype}/upload/${oldKey}.${ref.ext}`;
    // Source site_media row (if any) supplies filename/alt and lets us remap ids.
    const { data: srcRow } = oldKey
      ? await supabase
          .from('site_media').select('id, filename, alt_text, uploaded_by')
          .eq('storage_key', oldKey).maybeSingle()
      : { data: null };

    const id = randomUUID().replace(/-/g, '');
    const isVideo = !ref.external && ref.rtype === 'video';
    let result;
    try {
      result = await cloudinary.uploader.upload(sourceUrl, {
        folder: site.subdomain,
        public_id: id,
        resource_type: isVideo ? 'video' : 'image',
        // Images normalize to the standard capped WebP; videos copy untouched.
        ...(isVideo ? {} : { format: 'webp', quality: 'auto:good', width: MAX_IMAGE_DIMENSION, height: MAX_IMAGE_DIMENSION, crop: 'limit' }),
        context: { site_id: siteId, localized_from: ref.external ? ref.url.slice(0, 200) : oldKey },
      });
    } catch (err) {
      // A dead source reference (asset already deleted / hotlink 404) can't be
      // localized — skip it rather than fail the whole site; the reference was
      // already broken or stays external, no worse than before.
      const label = ref.external ? ref.url : `${oldKey}.${ref.ext}`;
      console.warn(`[localize] ${site.subdomain}: copy failed for ${label} (skipping):`, err?.message);
      skipped += 1;
      continue;
    }

    // Externals get a readable filename from the stock-photo id (e.g.
    // "photo-1503951914875.webp"); Cloudinary sources keep their filename.
    const externalName = ref.external
      ? `${(ref.url.match(/photo-[0-9a-f-]+/) || ['stock-image'])[0]}.webp`
      : null;

    const { data: newRow, error: insErr } = await supabase
      .from('site_media')
      .insert({
        site_id: siteId,
        filename: srcRow?.filename || externalName || `${ref.file}.${ref.ext}`,
        mime_type: isVideo ? 'video/mp4' : 'image/webp',
        size_bytes: result.bytes,
        width: result.width ?? null,
        height: result.height ?? null,
        storage_key: result.public_id,
        storage_provider: 'cloudinary',
        original_url: result.secure_url,
        alt_text: srcRow?.alt_text ?? null,
        uploaded_by: srcRow?.uploaded_by ?? null,
      })
      .select('id')
      .single();
    if (insErr) console.warn(`[localize] ${site.subdomain}: site_media insert failed:`, insErr.message);

    if (ref.external) {
      // One replacement pair: the exact external URL → the new Cloudinary URL.
      replacements.push([ref.url, result.secure_url]);
      copied += 1;
      assetLog.push({ from: ref.url, to: result.public_id });
    } else {
      const newKey = result.public_id;
      const newExt = isVideo ? ref.ext : 'webp';
      replacements.push([`${oldKey}.${ref.ext}`, `${newKey}.${newExt}`]);
      replacements.push([oldKey, newKey]);
      if (srcRow?.id && newRow?.id) replacements.push([srcRow.id, newRow.id]);
      copied += 1;
      assetLog.push({ from: `${oldKey}.${ref.ext}`, to: `${newKey}.${newExt}` });
    }
  }

  if (replacements.length === 0) {
    return { siteId, subdomain: site.subdomain, copied, rewrittenRows: 0, skipped, assets: assetLog };
  }
  // Longest-first so `key.ext` wins before the bare `key` fallback.
  replacements.sort((a, b) => b[0].length - a[0].length);
  const applyAll = (text) => replacements.reduce((t, [from, to]) => t.split(from).join(to), text);

  // 3. Rewrite the references in place (only rows/columns that changed).
  let rewrittenRows = 0;
  for (const s of SURFACES) {
    for (const row of rowsByTable[s.table]) {
      const patch = {};
      for (const col of s.cols) {
        const text = serializeCol(row[col]);
        if (!text) continue;
        const next = applyAll(text);
        if (next !== text) {
          patch[col] = typeof row[col] === 'string' ? next : JSON.parse(next);
        }
      }
      if (Object.keys(patch).length) {
        const { error } = await supabase.from(s.table).update(patch).eq('id', row.id);
        if (error) console.warn(`[localize] ${site.subdomain}: update ${s.table} ${row.id} failed:`, error.message);
        else rewrittenRows += 1;
      }
    }
  }

  return { siteId, subdomain: site.subdomain, copied, rewrittenRows, skipped, assets: assetLog };
}

/** Fire-and-forget wrapper for the provisioning paths — never throws, logs the
 *  outcome. The new site renders fine on shared references in the seconds the
 *  copies take; localization self-heals it right after. */
function scheduleLocalizeSiteMedia(siteId, label = '') {
  setImmediate(() => {
    // includeExternal: a clone also ingests any stock-photo hotlinks the source
    // carried, so new sites start fully self-contained on Cloudinary.
    localizeSiteMedia(siteId, { includeExternal: true })
      .then((r) => {
        if (r.copied || r.skipped) {
          console.log(`[localize] ${label || r.subdomain}: ${r.copied} asset(s) copied, ${r.rewrittenRows} row(s) rewritten${r.skipped ? `, ${r.skipped} dead ref(s) skipped` : ''}`);
        }
      })
      .catch((err) => console.warn(`[localize] ${label || siteId} failed:`, err?.message));
  });
}

module.exports = { localizeSiteMedia, scheduleLocalizeSiteMedia };
