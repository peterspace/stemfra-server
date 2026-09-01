// Stock photos (Unsplash) for the CMS image picker (backlog item, 2026-09-01).
// The owner searches Unsplash inside MediaSourceModal and picking a photo
// IMPORTS it: we trigger Unsplash's download endpoint (their API guideline for
// "user takes a copy"), pull the photo server-to-server into the site's own
// Cloudinary folder (capped WebP, same normalization as uploads), and write a
// site_media row — so the asset behaves exactly like an uploaded image
// (referenced scan, clone localization, per-site folder delete all work).
//
// Attribution: the search response carries author name + profile link (with the
// required utm params) and the CMS renders the credit; the import stores the
// provenance on site_media.metadata.
//
// Env: UNSPLASH_ACCESS_KEY (register a demo app at unsplash.com/developers —
// 50 requests/hour, enough for the picker). Absent key → the tab hides itself
// (healthcheck reports configured:false) and endpoints return 503.
//
// NOTE: config/supabase.js exports the client directly; single-var require.
const crypto = require('crypto');
const supabase = require('../../config/supabase');
const { cloudinary, isCloudinaryConfigured } = require('../../config/cloudinary');
const { verifySiteOwnership, resolveContactId } = require('../../middleware/cmsAuth');

const ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY || '';
const API = 'https://api.unsplash.com';
const UTM = 'utm_source=stemfra&utm_medium=referral';
const MAX_IMAGE_DIMENSION = 2560; // keep in step with uploadController

const configured = () => !!ACCESS_KEY && isCloudinaryConfigured();

async function unsplash(path) {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Client-ID ${ACCESS_KEY}`, 'Accept-Version': 'v1' },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Unsplash ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

// GET /api/cms/stock-photos/healthcheck — lets the CMS decide whether to show the tab.
function healthcheck(req, res) {
  res.json({ ok: true, configured: configured() });
}

// GET /api/cms/stock-photos/search?siteId=&q=&page=
async function search(req, res) {
  try {
    if (!configured()) return res.status(503).json({ error: 'Stock photos are not configured.' });
    const { siteId, q } = req.query;
    const page = Math.max(1, Number(req.query.page) || 1);
    if (!siteId || !q) return res.status(400).json({ error: 'siteId and q required' });
    const site = await verifySiteOwnership(req.cmsUser.id, siteId);
    if (!site) return res.status(403).json({ error: 'Not your site' });

    const data = await unsplash(`/search/photos?query=${encodeURIComponent(String(q))}&page=${page}&per_page=24&content_filter=high`);
    const results = (data.results || []).map((p) => ({
      id: p.id,
      thumb: p.urls?.small,
      preview: p.urls?.regular,
      width: p.width,
      height: p.height,
      alt: p.alt_description || p.description || '',
      author: p.user?.name || 'Unknown',
      authorLink: p.user?.links?.html ? `${p.user.links.html}?${UTM}` : null,
      downloadLocation: p.links?.download_location || null,
    }));
    res.json({ results, total: data.total ?? results.length, totalPages: data.total_pages ?? 1, page });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/cms/stock-photos/import { siteId, photoId }
// Re-reads the photo from Unsplash (fresh URLs), pings its download endpoint,
// pulls it into the site's Cloudinary folder as capped WebP, writes site_media.
async function importPhoto(req, res) {
  try {
    if (!configured()) return res.status(503).json({ error: 'Stock photos are not configured.' });
    const { siteId, photoId } = req.body || {};
    if (!siteId || !photoId || !/^[\w-]+$/.test(String(photoId))) {
      return res.status(400).json({ error: 'siteId and photoId required' });
    }
    const site = await verifySiteOwnership(req.cmsUser.id, siteId);
    if (!site) return res.status(403).json({ error: 'Not your site' });

    const photo = await unsplash(`/photos/${photoId}`);
    // Download tracking, per the Unsplash API guidelines. Best-effort.
    if (photo.links?.download_location) {
      fetch(photo.links.download_location, {
        headers: { Authorization: `Client-ID ${ACCESS_KEY}` },
      }).catch(() => { /* best-effort */ });
    }

    // Unsplash raw URLs accept imgix-style params; cap at our stored maximum so
    // we never ingest a 6000px original.
    const src = `${photo.urls.raw}&w=${MAX_IMAGE_DIMENSION}&q=85&fm=jpg`;
    const id = crypto.randomUUID().replace(/-/g, '');
    const result = await cloudinary.uploader.upload(src, {
      folder: site.subdomain,
      public_id: id,
      resource_type: 'image',
      overwrite: false,
      format: 'webp',
      quality: 'auto:good',
      transformation: [{ width: MAX_IMAGE_DIMENSION, height: MAX_IMAGE_DIMENSION, crop: 'limit' }],
    });

    const contactId = await resolveContactId(req.cmsUser.id);
    const alt = photo.alt_description || photo.description || '';
    const { data: row, error: dbErr } = await supabase
      .from('site_media')
      .insert({
        site_id: siteId,
        filename: `unsplash-${photo.id}.webp`,
        mime_type: 'image/webp',
        size_bytes: result.bytes,
        width: result.width,
        height: result.height,
        storage_provider: 'cloudinary',
        storage_key: result.public_id,
        original_url: result.secure_url,
        alt_text: alt || null,
        uploaded_by: contactId,
        metadata: {
          source: 'unsplash',
          unsplash_id: photo.id,
          author: photo.user?.name || null,
          author_link: photo.user?.links?.html || null,
        },
      })
      .select('id')
      .single();
    if (dbErr) throw new Error(`site_media: ${dbErr.message}`);

    res.json({ mediaId: row.id, secure_url: result.secure_url, alt, width: result.width, height: result.height });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { healthcheck, search, importPhoto };
