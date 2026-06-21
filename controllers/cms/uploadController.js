const crypto = require('crypto');
const { cloudinary, isCloudinaryConfigured } = require('../../config/cloudinary');
// NOTE: config/supabase.js exports the client directly; single-var require.
const supabase = require('../../config/supabase');
const { verifySiteOwnership, resolveContactId } = require('../../middleware/cmsAuth');

// ─── Allowed input MIME types ────────────────────────────────────────────────
// Images are accepted in JPG/PNG/WebP/GIF; server transcodes ALL of them to
// WebP at delivery time via Cloudinary's `format: 'webp'` + `quality: 'auto:good'`.
// Videos must be h.264 mp4 in v1 — Cloudinary handles container/codec
// normalization internally if needed.
const ALLOWED_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);
const ALLOWED_VIDEO_MIMES = new Set([
  'video/mp4',
]);
const MAX_IMAGE_BYTES = 30 * 1024 * 1024;    // 30MB raw input cap; post-WebP usually 200-900KB (rare uploads of branding photos can reach this)
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;   // 100MB hard cap (ambient hero loops can be hefty); 15s recommended via client-side

function isImageMime(m) { return m && m.startsWith('image/'); }
function isVideoMime(m) { return m && m.startsWith('video/'); }

/**
 * GET /api/cms/site-uploads/healthcheck
 *
 * Unauthenticated. Returns whether Cloudinary env vars are present.
 * Use in production to verify a deploy picked up the secrets correctly.
 */
function healthcheck(req, res) {
  res.json({
    ok: true,
    cloudinary_configured: isCloudinaryConfigured(),
    endpoint: 'cms/site-uploads',
    version: '2c',
  });
}

/**
 * POST /api/cms/site-uploads/upload
 * multipart/form-data:
 *   - field "siteId": the target site's UUID
 *   - field "alt" (optional): alt text (images only — videos ignore)
 *   - file "image": the file (field name is a legacy misnomer; accepts video too)
 *
 * Routes by MIME type:
 *   - image/*  → resource_type='image', format='webp', quality='auto:good',
 *                size cap 8MB. Stored as WebP regardless of input format;
 *                `mime_type` in DB is normalized to 'image/webp'.
 *   - video/mp4 → resource_type='video', no format transform, size cap 50MB.
 *
 * Cloudinary folder = site.subdomain (e.g. 'argyle-and-sons').
 * Storage_key = result.public_id (e.g. 'argyle-and-sons/{hash}').
 * Pre-Phase-2 uploads (`sites/{uuid}/{hash}`) still resolve via their absolute URLs.
 */
async function uploadImage(req, res) {
  const bb = req.busboy;
  if (!bb) return res.status(500).json({ error: 'Busboy not initialized' });

  let siteId = null;
  let altText = null;
  let fileProcessed = false;
  let responded = false;

  const sendOnce = (status, body) => {
    if (responded) return;
    responded = true;
    res.status(status).json(body);
  };

  bb.on('field', (name, val) => {
    if (name === 'siteId') siteId = String(val).trim();
    else if (name === 'alt') altText = String(val);
  });

  bb.on('file', (fieldname, file, info) => {
    if (responded) { file.resume(); return; }
    if (fieldname !== 'image') {
      file.resume();
      return sendOnce(400, { error: 'Invalid file field name; expected "image"' });
    }
    if (fileProcessed) {
      file.resume();
      return sendOnce(400, { error: 'Multiple files not allowed' });
    }
    fileProcessed = true;

    const mimeType = info.mimeType;
    const filename = info.filename;

    if (!siteId) {
      file.resume();
      return sendOnce(400, { error: 'siteId required (send as a form field before the file)' });
    }

    // ─── MIME sniff: route to image or video flow ────────────────────────────
    const isImage = isImageMime(mimeType);
    const isVideo = isVideoMime(mimeType);

    if (!isImage && !isVideo) {
      file.resume();
      return sendOnce(400, {
        error: 'Unsupported file type',
        allowed: [...ALLOWED_IMAGE_MIMES, ...ALLOWED_VIDEO_MIMES],
      });
    }
    if (isImage && !ALLOWED_IMAGE_MIMES.has(mimeType)) {
      file.resume();
      return sendOnce(400, { error: 'Unsupported image type', allowed: Array.from(ALLOWED_IMAGE_MIMES) });
    }
    if (isVideo && !ALLOWED_VIDEO_MIMES.has(mimeType)) {
      file.resume();
      return sendOnce(400, { error: 'Video must be mp4 (h.264).' });
    }

    const maxBytes = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    const maxLabel = isVideo ? '50MB' : '8MB';

    // NOTE: do NOT attach a `data` listener here — it would switch the file stream
    // into flowing mode BEFORE we've awaited the ownership check, causing the
    // bytes to be consumed by an empty listener and the stream to end before
    // we pipe to Cloudinary. Cloudinary then sees 0 bytes → "Empty file" 400.
    // Attach the byte counter inside the .then() below, immediately before pipe.
    let aborted = false;

    verifySiteOwnership(req.cmsUser.id, siteId).then(async (site) => {
      if (aborted || responded) return;
      if (!site) {
        file.resume();
        return sendOnce(403, { error: 'You do not own this site' });
      }

      const contactId = await resolveContactId(req.cmsUser.id);
      const id = crypto.randomUUID().replace(/-/g, '');
      // Phase 2: Cloudinary folder = site.subdomain (human-readable in the
      // dashboard, easy bulk-delete per customer). `verifySiteOwnership`
      // already returns the site row including subdomain — no extra DB read.
      const folder = site.subdomain;

      // Now safe to attach the byte counter — we're about to pipe in the
      // same synchronous tick, so no bytes can be consumed-and-discarded.
      let bytesReceived = 0;
      file.on('data', (chunk) => {
        bytesReceived += chunk.length;
        if (bytesReceived > maxBytes && !aborted) {
          aborted = true;
          file.unpipe();
          file.resume();
          sendOnce(413, {
            error: isVideo
              ? `Video too big (max ${maxLabel}).`
              : `File too large (max ${maxBytes} bytes)`,
          });
        }
      });

      // ─── Cloudinary upload options ─────────────────────────────────────────
      const uploadOptions = {
        folder,
        public_id: id,
        resource_type: isVideo ? 'video' : 'image',
        context: {
          site_id: siteId,
          uploaded_by: contactId || '',
          alt: isVideo ? '' : (altText || ''),   // videos ignore alt
        },
      };

      if (isImage) {
        // Auto-WebP transcode + smart quality picker. Inputs of JPG/PNG/WebP/GIF
        // become WebP (or animated WebP for GIFs) at delivery time. Storage size
        // typically 5-10x smaller than raw input.
        uploadOptions.format = 'webp';
        uploadOptions.quality = 'auto:good';
      }
      // Video: no format/quality transformation in v1. Cloudinary's video pipeline
      // handles h.264 normalization internally; we could add eager: [{ ... thumb }]
      // later for thumbnail generation if Hero archetypes need a poster image.

      const uploadStream = cloudinary.uploader.upload_stream(
        uploadOptions,
        async (error, result) => {
          if (aborted || responded) return;
          if (error || !result) {
            console.error('[uploads] cloudinary error:', error);
            return sendOnce(500, { error: 'Upload failed', details: error?.message });
          }

          // Normalize stored mime_type to the OUTPUT format:
          //   - image: 'image/webp' (regardless of input — that's what Cloudinary delivers)
          //   - video: keep original 'video/mp4' (no transcoding)
          const storedMime = isImage ? 'image/webp' : mimeType;

          const { data: media, error: mediaErr } = await supabase
            .from('site_media')
            .insert({
              site_id: siteId,
              filename: filename,
              mime_type: storedMime,
              size_bytes: result.bytes,
              width: result.width ?? null,
              height: result.height ?? null,
              storage_key: result.public_id,
              storage_provider: 'cloudinary',
              original_url: result.secure_url,
              alt_text: isVideo ? null : (altText || null),
              uploaded_by: contactId,
            })
            .select()
            .single();

          if (mediaErr) {
            console.warn('[uploads] site_media insert failed:', mediaErr);
          }

          return sendOnce(200, {
            mediaId: media?.id || null,
            secure_url: result.secure_url,
            public_id: result.public_id,
            width: result.width ?? null,
            height: result.height ?? null,
            bytes: result.bytes,
            format: result.format,
            mime_type: storedMime,
            resource_type: isVideo ? 'video' : 'image',
          });
        }
      );

      file.pipe(uploadStream);
    }).catch((err) => {
      console.error('[uploads] ownership check error:', err);
      file.resume();
      sendOnce(500, { error: 'Ownership verification failed' });
    });
  });

  bb.on('finish', () => {
    if (!fileProcessed && !responded) sendOnce(400, { error: 'No file uploaded' });
  });

  bb.on('error', (err) => {
    console.error('[uploads] busboy error:', err);
    if (!responded) sendOnce(500, { error: 'Upload processing failed' });
  });

  req.pipe(bb);
}

/**
 * DELETE /api/cms/site-uploads/:mediaId
 *
 * Validates auth + ownership. Calls cloudinary.destroy with the correct
 * resource_type based on the stored mime_type (videos require 'video' or
 * Cloudinary returns "not found"). Best-effort on the Cloudinary side —
 * if destroy fails, the DB row is still deleted to avoid stuck rows.
 */
async function deleteMedia(req, res) {
  try {
    const { mediaId } = req.params;
    if (!mediaId) return res.status(400).json({ error: 'mediaId required' });

    const { data: media, error: mediaErr } = await supabase
      .from('site_media')
      .select('*')
      .eq('id', mediaId)
      .single();
    if (mediaErr || !media) return res.status(404).json({ error: 'Media not found' });

    const site = await verifySiteOwnership(req.cmsUser.id, media.site_id);
    if (!site) return res.status(403).json({ error: 'You do not own this site' });

    if (media.storage_provider === 'cloudinary' && media.storage_key) {
      // Phase 2: derive resource_type from stored mime_type so video destroys hit
      // Cloudinary's video pipeline, not the image one.
      const resourceType = isVideoMime(media.mime_type) ? 'video' : 'image';
      try {
        await cloudinary.uploader.destroy(media.storage_key, { resource_type: resourceType });
      } catch (cdnErr) {
        console.warn('[uploads/delete] cloudinary destroy failed (continuing):', cdnErr);
      }
    }

    const { error: delErr } = await supabase.from('site_media').delete().eq('id', mediaId);
    if (delErr) return res.status(500).json({ error: 'Failed to delete media row' });

    return res.json({ ok: true });
  } catch (err) {
    console.error('[uploads/delete] error:', err);
    return res.status(500).json({ error: 'Delete failed' });
  }
}

/**
 * GET /api/cms/site-uploads?siteId=<uuid>
 *
 * Auth + ownership gated. Lists the site's media assets (newest first) for the
 * Media library. Each asset gets a best-effort `referenced` flag: we build one
 * haystack from everything that can point at an asset (section content, services,
 * team, testimonials, theme settings) and check whether the asset's id OR its
 * URL appears in it. Shape-agnostic on purpose — media ids live in many nested
 * JSONB shapes (hero image_media_id, gallery images[].mediaId, category_cards[]
 * photo_media_id, logo, per-service/team/testimonial photos), so a substring
 * scan over the serialized rows is more robust than enumerating every field.
 * UUIDs don't collide, so false positives are effectively nil; we match URLs too
 * to catch references that stored only the URL (no media id).
 */
async function buildUsageHaystack(siteId) {
  // content-only for sections (smaller payload); whole row for the rest.
  const tables = [
    ['site_sections', 'content'],
    ['site_services', '*'],
    ['site_team_members', '*'],
    ['site_testimonials', '*'],
    ['site_theme_settings', '*'],
  ];
  const parts = [];
  for (const [table, cols] of tables) {
    try {
      const { data } = await supabase.from(table).select(cols).eq('site_id', siteId);
      if (data && data.length) parts.push(JSON.stringify(data));
    } catch (err) {
      console.warn(`[uploads/list] usage scan skipped ${table}:`, err?.message || err);
    }
  }
  return parts.join('\n');
}

async function listMedia(req, res) {
  try {
    const siteId = req.query.siteId;
    if (!siteId) return res.status(400).json({ error: 'siteId required' });

    const site = await verifySiteOwnership(req.cmsUser.id, siteId);
    if (!site) return res.status(403).json({ error: 'You do not own this site' });

    const { data: media, error } = await supabase
      .from('site_media')
      .select('id, filename, mime_type, size_bytes, width, height, original_url, storage_key, alt_text, created_at, storage_provider')
      .eq('site_id', siteId)
      .order('created_at', { ascending: false });
    if (error) {
      console.error('[uploads/list] db error:', error);
      return res.status(500).json({ error: 'Failed to list media' });
    }

    const haystack = await buildUsageHaystack(siteId);
    // Match on media id (the *_media_id references), the stored URL, AND the
    // Cloudinary storage_key/public_id — the key appears in EVERY URL variant
    // of an asset (incl. transformed URLs), so it catches references whose
    // stored URL differs from our canonical original_url.
    const withUsage = (media || []).map((m) => ({
      ...m,
      referenced:
        haystack.includes(m.id) ||
        (!!m.original_url && haystack.includes(m.original_url)) ||
        (!!m.storage_key && haystack.includes(m.storage_key)),
    }));

    return res.json({ media: withUsage });
  } catch (err) {
    console.error('[uploads/list] error:', err);
    return res.status(500).json({ error: 'List failed' });
  }
}

module.exports = { healthcheck, uploadImage, deleteMedia, listMedia };
