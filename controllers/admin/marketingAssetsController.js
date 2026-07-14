// Marketing-site imagery (the CRM "Site imagery" tab). Every static image on
// stemfra.com (hero backdrops, vertical photos, About/Start/Contact photos)
// lives in the marketing_assets table as a SLOT (dot-path like
// `home.hero.photo`) → Cloudinary URL under stemfra_assets/marketing/.
// Replacing a slot's image here re-skins the marketing site with no deploy.
// Distinct from demo MOCKUPS (sites.metadata.marketing_mockups — composed
// screenshots of demo sites); this table is for standalone photography.
// Convention: single-var supabase import (config exports the client directly).
const supabase = require('../../config/supabase');
const { cloudinary, isCloudinaryConfigured } = require('../../config/cloudinary');

const MARKETING_FOLDER = 'stemfra_assets/marketing';
const SLOT_RE = /^[a-z0-9_]+(\.[a-z0-9_]+)+$/;
const publicIdFor = (slot) => `${MARKETING_FOLDER}/${slot.replace(/\./g, '-')}`;

// GET /api/admin/marketing-assets — every slot row, grouped for the CRM grid.
async function listMarketingAssets(req, res) {
  try {
    const { data, error } = await supabase
      .from('marketing_assets')
      .select('*')
      .order('group_key')
      .order('slot');
    if (error) throw error;
    res.json({ assets: data || [] });
  } catch (err) {
    console.error('listMarketingAssets failed:', err.message);
    res.status(500).json({ error: err.message });
  }
}

// POST /api/admin/marketing-assets/upload — multipart { slot, label?, alt? } + image.
// Uploads to the slot's FIXED public_id (overwrite + invalidate) and upserts the
// row, so replacing an image is one call and the site picks it up on next load.
async function uploadMarketingAsset(req, res) {
  if (!isCloudinaryConfigured()) return res.status(503).json({ error: 'Cloudinary is not configured.' });
  const bb = req.busboy;
  if (!bb) return res.status(500).json({ error: 'Busboy not initialized' });

  const fields = {};
  let fileHandled = false;
  let responded = false;
  const sendOnce = (status, body) => { if (!responded) { responded = true; res.status(status).json(body); } };

  let uploadPromise = null;
  bb.on('field', (name, value) => { fields[name] = value; });
  bb.on('file', (fieldname, file, info) => {
    if (responded || fileHandled) { file.resume(); return; }
    fileHandled = true;
    if (!/^image\//.test(info.mimeType || '')) { file.resume(); return sendOnce(400, { error: 'Image files only' }); }
    // Buffer the stream so the slot field is guaranteed parsed before upload
    // (field order in multipart bodies is client-controlled).
    const chunks = [];
    uploadPromise = new Promise((resolve, reject) => {
      file.on('data', (c) => chunks.push(c));
      file.on('end', () => resolve(Buffer.concat(chunks)));
      file.on('error', reject);
    });
  });
  bb.on('finish', async () => {
    if (responded) return;
    try {
      const slot = String(fields.slot || '').trim();
      if (!SLOT_RE.test(slot)) return sendOnce(400, { error: 'slot must be a dot-path like home.hero.photo' });
      if (!uploadPromise) return sendOnce(400, { error: 'No image file uploaded' });
      const buffer = await uploadPromise;
      if (!buffer.length) return sendOnce(400, { error: 'Empty file' });

      const result = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { public_id: publicIdFor(slot), resource_type: 'image', overwrite: true, invalidate: true },
          (error, r) => (error || !r ? reject(error || new Error('Upload failed')) : resolve(r))
        );
        stream.end(buffer);
      });

      const row = {
        slot,
        url: result.secure_url,
        storage_key: result.public_id,
        width: result.width,
        height: result.height,
        bytes: result.bytes,
        mime_type: `image/${result.format}`,
      };
      if (fields.label) row.label = String(fields.label);
      if (fields.group_key) row.group_key = String(fields.group_key);
      if (fields.alt !== undefined) row.alt_text = String(fields.alt);
      const { data, error } = await supabase
        .from('marketing_assets')
        .upsert(row, { onConflict: 'slot' })
        .select()
        .single();
      if (error) throw error;
      sendOnce(200, { asset: data });
    } catch (err) {
      console.error('uploadMarketingAsset failed:', err.message);
      sendOnce(500, { error: err.message });
    }
  });
  bb.on('error', (err) => { console.error('uploadMarketingAsset busboy error:', err); sendOnce(500, { error: 'Upload processing failed' }); });
  req.pipe(bb); // connect-busboy (no `immediate`) requires piping the request into busboy
}

// PATCH /api/admin/marketing-assets — { slot, alt_text?, label? } metadata edits.
async function updateMarketingAsset(req, res) {
  const { slot, alt_text, label } = req.body || {};
  if (!slot || !SLOT_RE.test(slot)) return res.status(400).json({ error: 'Valid slot required' });
  const patch = {};
  if (alt_text !== undefined) patch.alt_text = alt_text;
  if (label !== undefined) patch.label = label;
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to update' });
  try {
    const { data, error } = await supabase
      .from('marketing_assets')
      .update(patch)
      .eq('slot', slot)
      .select()
      .single();
    if (error) throw error;
    res.json({ asset: data });
  } catch (err) {
    console.error('updateMarketingAsset failed:', err.message);
    res.status(500).json({ error: err.message });
  }
}

// POST /api/admin/marketing-assets/delete — { slot } → the surface simply hides
// on the marketing site (no fallback slots by design). Cloudinary destroy is
// best-effort; the row delete is what the site reads.
async function deleteMarketingAsset(req, res) {
  const { slot } = req.body || {};
  if (!slot || !SLOT_RE.test(slot)) return res.status(400).json({ error: 'Valid slot required' });
  try {
    const { data: row, error: readErr } = await supabase
      .from('marketing_assets')
      .select('storage_key')
      .eq('slot', slot)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!row) return res.status(404).json({ error: 'Slot not found' });
    if (row.storage_key && row.storage_key.startsWith(`${MARKETING_FOLDER}/`)) {
      try {
        await cloudinary.uploader.destroy(row.storage_key, { resource_type: 'image', invalidate: true });
      } catch (err) {
        console.error('deleteMarketingAsset cloudinary destroy failed (continuing):', err.message);
      }
    }
    const { error } = await supabase.from('marketing_assets').delete().eq('slot', slot);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('deleteMarketingAsset failed:', err.message);
    res.status(500).json({ error: err.message });
  }
}

// PUBLIC — GET /api/marketing/assets → { assets: { [slot]: { url, width, height, alt } } }.
// Consumed by stemfra_client lib/marketingAssets.js; slots absent here simply
// don't render on the site (no fallback slots by design).
async function marketingAssets(req, res) {
  try {
    const { data, error } = await supabase
      .from('marketing_assets')
      .select('slot,url,width,height,alt_text');
    if (error) throw error;
    const assets = {};
    for (const a of data || []) {
      assets[a.slot] = { url: a.url, width: a.width, height: a.height, alt: a.alt_text || '' };
    }
    res.json({ assets });
  } catch (err) {
    console.error('marketingAssets failed:', err.message);
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  listMarketingAssets,
  uploadMarketingAsset,
  updateMarketingAsset,
  deleteMarketingAsset,
  marketingAssets,
};
