// Server-side capture of a marketing mockup: render the CRM's chrome-less
// /render/mockup route in a headless Chromium at retina scale, screenshot the
// composed scene, and upload the PNG to Cloudinary (stemfra_assets/mockups).
// The CRM composer POSTs the exact MockupScene config; the returned URL is what
// the marketing site uses. Staff-gated (PLATFORM_OPS).
const crypto = require('crypto');
const { chromium } = require('playwright');
const sharp = require('sharp');
const { cloudinary, isCloudinaryConfigured } = require('../../config/cloudinary');
const supabase = require('../../config/supabase');
const { previewUrlFor } = require('../../lib/starters');

// Where the public render route is served (the CRM SPA).
const RENDER_BASE =
  process.env.MOCKUP_RENDER_URL ||
  (process.env.NODE_ENV === 'production' ? 'https://crm.stemfra.com' : 'http://localhost:5178');

async function capture(req, res) {
  const { config } = req.body || {};
  if (!config || !config.layout) {
    return res.status(400).json({ error: 'A `config` with a `layout` is required.' });
  }
  if (!isCloudinaryConfigured()) {
    return res.status(503).json({ error: 'Cloudinary is not configured on the server.' });
  }

  const scale = Math.min(Math.max(Number(config.scale) || 2, 1), 4); // retina density (2–4×)
  const width = Math.min(Math.max(Number(config.width) || 1280, 320), 2400);
  const b64 = Buffer.from(JSON.stringify({ ...config, width })).toString('base64');
  const url = `${RENDER_BASE}/render/mockup?config=${encodeURIComponent(b64)}`;

  let browser;
  try {
    browser = await chromium.launch({ args: ['--no-sandbox'] });
    const page = await browser.newPage({
      deviceScaleFactor: scale,
      viewport: { width: width + 80, height: 2000 },
    });
    // domcontentloaded (not networkidle) — the CRM dev server keeps an HMR socket open.
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction('window.__mockupReady === true', null, { timeout: 30000 });

    const el = await page.$('#mockup-capture');
    if (!el) throw new Error('render target #mockup-capture not found');
    const png = await el.screenshot({ type: 'png', omitBackground: true });

    await browser.close();
    browser = null;

    // Transcode to WebP (keeps transparency, ~5-10× smaller than PNG for photo-heavy
    // composites) so high-res (3-4×+) masters stay well under Cloudinary's upload cap.
    const buf = await sharp(png).webp({ quality: 92, effort: 4 }).toBuffer();

    const uploaded = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: 'stemfra_assets/mockups', resource_type: 'image', format: 'webp' },
        (err, result) => (err ? reject(err) : resolve(result))
      );
      stream.end(buf);
    });

    res.json({
      url: uploaded.secure_url,
      public_id: uploaded.public_id,
      width: uploaded.width,
      height: uploaded.height,
      bytes: uploaded.bytes,
    });
  } catch (err) {
    if (browser) { try { await browser.close(); } catch { /* ignore */ } }
    console.error('mockup capture failed:', err.message);
    res.status(500).json({ error: err.message });
  }
}

// ── Brand-asset library (card sources) — stemfra_assets/mockups/sources ──────
const SOURCES_FOLDER = 'stemfra_assets/mockups/sources';

// GET /api/admin/mockups/assets — list uploaded card-source images, newest first.
async function listAssets(req, res) {
  if (!isCloudinaryConfigured()) return res.status(503).json({ error: 'Cloudinary is not configured.' });
  try {
    const result = await cloudinary.search
      .expression(`folder:${SOURCES_FOLDER}`)
      .sort_by('created_at', 'desc')
      .max_results(100)
      .execute();
    const assets = (result.resources || []).map((r) => ({
      public_id: r.public_id,
      url: r.secure_url,
      width: r.width,
      height: r.height,
      bytes: r.bytes,
      created_at: r.created_at,
    }));
    res.json({ assets });
  } catch (err) {
    console.error('mockup listAssets failed:', err.message);
    res.status(500).json({ error: err.message });
  }
}

// POST /api/admin/mockups/upload — multipart image → stemfra_assets/mockups/sources (WebP).
async function uploadAsset(req, res) {
  if (!isCloudinaryConfigured()) return res.status(503).json({ error: 'Cloudinary is not configured.' });
  const bb = req.busboy;
  if (!bb) return res.status(500).json({ error: 'Busboy not initialized' });

  let fileProcessed = false;
  let responded = false;
  const sendOnce = (status, body) => { if (!responded) { responded = true; res.status(status).json(body); } };

  bb.on('file', (fieldname, file, info) => {
    if (responded) { file.resume(); return; }
    if (fileProcessed) { file.resume(); return sendOnce(400, { error: 'Multiple files not allowed' }); }
    fileProcessed = true;
    if (!/^image\//.test(info.mimeType || '')) { file.resume(); return sendOnce(400, { error: 'Image files only' }); }

    const uploadStream = cloudinary.uploader.upload_stream(
      { folder: SOURCES_FOLDER, resource_type: 'image', format: 'webp', quality: 'auto:good' },
      (error, result) => {
        if (responded) return;
        if (error || !result) {
          console.error('mockup upload cloudinary error:', error);
          return sendOnce(500, { error: 'Upload failed', details: error?.message });
        }
        sendOnce(200, { url: result.secure_url, public_id: result.public_id, width: result.width, height: result.height, bytes: result.bytes });
      }
    );
    file.pipe(uploadStream);
  });
  bb.on('finish', () => { if (!fileProcessed && !responded) sendOnce(400, { error: 'No file uploaded' }); });
  bb.on('error', (err) => { console.error('mockup upload busboy error:', err); sendOnce(500, { error: 'Upload processing failed' }); });
  req.pipe(bb); // connect-busboy (no `immediate`) requires piping the request into busboy
}

// POST /api/admin/mockups/assets/delete — { public_id } → Cloudinary destroy.
async function deleteAsset(req, res) {
  const { public_id } = req.body || {};
  if (!public_id || typeof public_id !== 'string') return res.status(400).json({ error: 'public_id required' });
  // Guard: only allow deleting inside our marketing folder.
  if (!public_id.startsWith('stemfra_assets/mockups/')) return res.status(400).json({ error: 'Refusing to delete outside stemfra_assets/mockups.' });
  try {
    const result = await cloudinary.uploader.destroy(public_id, { resource_type: 'image' });
    res.json({ ok: result.result === 'ok', result: result.result });
  } catch (err) {
    console.error('mockup deleteAsset failed:', err.message);
    res.status(500).json({ error: err.message });
  }
}

// POST /api/admin/mockups/screenshot-demo — screenshot a demo page's top fold → sources.
// Client sends { starterId, path } (NOT a raw URL) so the server resolves the real demo
// preview URL itself — no arbitrary URLs reach Playwright (SSRF-safe).
const PAGE_SLUG_RE = /^[a-z0-9]+(?:[-/][a-z0-9]+)*$/; // e.g. 'services', 'services/haircuts'

async function screenshotDemo(req, res) {
  const { starterId, path = '', scale: rawScale, fullPage = false, viewportHeight, viewportWidth, clip } = req.body || {};
  if (!starterId) return res.status(400).json({ error: 'starterId required' });
  if (!isCloudinaryConfigured()) return res.status(503).json({ error: 'Cloudinary is not configured.' });

  // Region commit (the crop tool's "Use this crop"): re-capture JUST the framed region
  // at high res. The 2× master is only the selection surface; final pixels are 4×.
  const clipMode = !fullPage && clip && typeof clip === 'object'
    ? {
        x: Math.max(0, Math.round(clip.x) || 0),
        y: Math.max(0, Math.round(clip.y) || 0),
        width: Math.max(16, Math.round(clip.width) || 0),
        height: Math.max(16, Math.round(clip.height) || 0),
      }
    : null;

  // Resolve the demo site → its public preview URL. Must be a real Starter/demo site.
  const { data: site, error } = await supabase
    .from('sites')
    .select('subdomain, custom_domain, status, metadata')
    .eq('id', starterId)
    .maybeSingle();
  if (error || !site) return res.status(404).json({ error: 'Demo site not found' });
  if (!site.metadata || !site.metadata.is_starter) return res.status(400).json({ error: 'Not a demo/Starter site' });

  const slug = String(path).replace(/^\/+/, '').trim();
  if (slug && !PAGE_SLUG_RE.test(slug)) return res.status(400).json({ error: 'Invalid page path' });
  const target = previewUrlFor(site) + (slug ? `/${slug}` : '');

  // Capture scale — 4× is the library standard (Peter: every Cloudinary upload should
  // be 4× by default, not just the composed mockup):
  //   • full-page masters are the exception, pinned to 2× — a 4× full page breaks
  //     WebP's 16383px side limit, Chromium raster memory, and Cloudinary's ~25MP cap
  //     (they're the crop tool's SELECTION surface, not final pixels);
  //   • region commits (clip) run at 4×, backed off only if the region itself would
  //     bust the WebP side limit or the ~25MP Cloudinary cap;
  //   • the legacy top-fold mode defaults to 4× now too.
  const scale = fullPage
    ? 2
    : clipMode
      ? Math.min(4, 16000 / Math.max(clipMode.width, clipMode.height), Math.sqrt(24e6 / (clipMode.width * clipMode.height)))
      : Math.min(Math.max(Number(rawScale) || 4, 1), 4);
  // The full-page/region viewport is the DEVICE the page is rendered as (CSS px, like
  // Chrome DevTools presets — physical retina px are viewport × deviceScaleFactor):
  //   • width drives the responsive layout (430 = real phone layout, 1440 = MacBook Air…)
  //   • height sizes 100vh sections (heroes), i.e. the fold shape.
  // Region commits reuse the SAME viewport as the master render so the layout matches.
  // The legacy top-fold mode stays fixed at 1280×960.
  const width = (fullPage || clipMode) ? Math.min(Math.max(Number(viewportWidth) || 1280, 320), 2048) : 1280;
  const height = (fullPage || clipMode) ? Math.min(Math.max(Number(viewportHeight) || 720, 480), 1440) : 960;
  const isMobile = (fullPage || clipMode) && width < 700; // phone-sized → emulate mobile (touch, mobile meta)

  let browser;
  try {
    browser = await chromium.launch({ args: ['--no-sandbox'] });
    const page = await browser.newPage({ deviceScaleFactor: scale, viewport: { width, height }, isMobile, hasTouch: isMobile });
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // Templates fetch their site data client-side — wait for the network to settle, then
    // give fonts/hero images a moment. Best-effort: don't fail the shot if idle never comes.
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(800);
    // Hide preview chrome that would spoil hero imagery — both are position:fixed, so
    // hiding them doesn't reflow the fold: the PreviewRibbon (role="status") + the Front
    // Desk chat launcher (aria-label="Chat with us").
    await page
      .addStyleTag({ content: '[role="status"],[aria-label="Chat with us"]{display:none!important}' })
      .catch(() => {});

    if (clipMode) {
      // 4× REGION COMMIT — capture exactly the frame chosen on the 2× master.
      // Scroll through first so lazy content inside/below the fold is painted.
      await page.evaluate(async () => {
        await new Promise((resolve) => {
          let y = 0;
          const step = () => {
            y += 600;
            window.scrollTo(0, y);
            if (y >= document.documentElement.scrollHeight) return resolve();
            setTimeout(step, 100);
          };
          step();
        });
      });
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(400);

      // Clamp the region to the actual page bounds (this render can differ by a few px
      // from the master render) — Playwright errors on clips outside the page.
      const pageH = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));
      const cw = Math.min(clipMode.width, width);
      const ch = Math.min(clipMode.height, pageH);
      const cx = Math.min(clipMode.x, Math.max(0, width - cw));
      const cy = Math.min(clipMode.y, Math.max(0, pageH - ch));

      // fullPage:true makes the clip DOCUMENT-relative (Playwright ≥1.50) — without it,
      // clip is viewport-relative and any region below the fold errors out.
      const png = await page.screenshot({ type: 'png', fullPage: true, clip: { x: cx, y: cy, width: cw, height: ch } });
      await browser.close();
      browser = null;

      const buf = await sharp(png).webp({ quality: 92 }).toBuffer();
      const uploaded = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: SOURCES_FOLDER, resource_type: 'image', format: 'webp' },
          (err, result) => (err ? reject(err) : resolve(result))
        );
        stream.end(buf);
      });
      return res.json({
        url: uploaded.secure_url,
        public_id: uploaded.public_id,
        width: uploaded.width,
        height: uploaded.height,
        bytes: uploaded.bytes,
        source: target,
        scale: Math.round(scale * 100) / 100,
      });
    }

    if (fullPage) {
      // Full-page MASTER for the CRM crop tool. Scroll through the page first so
      // lazy-loaded images below the fold actually render, then shoot the whole page.
      await page.evaluate(async () => {
        await new Promise((resolve) => {
          let y = 0;
          const step = () => {
            y += 600;
            window.scrollTo(0, y);
            if (y >= document.documentElement.scrollHeight) return resolve();
            setTimeout(step, 100);
          };
          step();
        });
      });
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(400);

      const fullPng = await page.screenshot({ type: 'png', fullPage: true });
      await browser.close();
      browser = null;

      let img = sharp(fullPng);
      const meta = await img.metadata();
      const maxH = 16000; // WebP hard limit is 16383px per side
      if (meta.height > maxH) img = img.extract({ left: 0, top: 0, width: meta.width, height: maxH });
      const buf2 = await img.webp({ quality: 90 }).toBuffer();
      const outMeta = await sharp(buf2).metadata();

      // Best-effort: ALSO persist a downscaled reference of the full page to Cloudinary
      // (stemfra_assets/mockups/masters) so the render stays browsable later. Sized to
      // whatever fits Cloudinary's ~25 MP image cap (a 2× full page is ~37 MP, so the
      // full-res master itself can't be uploaded; short pages keep their full 2× width).
      let masterUrl = null;
      try {
        const refScale = Math.min(1, Math.sqrt(24e6 / (outMeta.width * outMeta.height)));
        const refW = Math.max(640, Math.floor(outMeta.width * refScale));
        const refBuf = await sharp(buf2).resize({ width: refW }).webp({ quality: 85 }).toBuffer();
        const uploadedRef = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            { folder: 'stemfra_assets/mockups/masters', resource_type: 'image', format: 'webp' },
            (err, result) => (err ? reject(err) : resolve(result))
          );
          stream.end(refBuf);
        });
        masterUrl = uploadedRef.secure_url;
      } catch (refErr) {
        console.warn('mockup master reference upload failed:', refErr.message);
      }

      // The working master is returned INLINE (base64) for the crop tool; only the
      // crops the operator cuts from it land in the sources library.
      return res.json({
        master: `data:image/webp;base64,${buf2.toString('base64')}`,
        width: outMeta.width,
        height: outMeta.height,
        source: target,
        masterUrl,
      });
    }

    const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width, height } });
    await browser.close();
    browser = null;

    const buf = await sharp(png).webp({ quality: 90 }).toBuffer();
    const uploaded = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: SOURCES_FOLDER, resource_type: 'image', format: 'webp' },
        (err, result) => (err ? reject(err) : resolve(result))
      );
      stream.end(buf);
    });
    res.json({ url: uploaded.secure_url, public_id: uploaded.public_id, width: uploaded.width, height: uploaded.height, bytes: uploaded.bytes, source: target });
  } catch (err) {
    if (browser) { try { await browser.close(); } catch { /* ignore */ } }
    console.error('mockup screenshotDemo failed:', err.message);
    res.status(500).json({ error: err.message });
  }
}

// ── Prepared masters — demo pages stored as 4× tiles (reusable crop surfaces) ──────
// One Cloudinary image can't exceed ~25MP, so a full page at 4× is stored as a stack of
// horizontal TILES (each ≤ ~24MP). The tile map lives on the demo's
// metadata.mockup_masters keyed by `${page||'home'}@${vpW}x${vpH}` — prepared pages make
// the crop tool instant (no re-render) and crops stay 4×.
const MASTERS_FOLDER = 'stemfra_assets/mockups/masters';
const MASTER_SCALE = 4;

const masterKeyFor = (slug, width, height) => `${slug || 'home'}@${width}x${height}`;

// POST /api/admin/mockups/prepare-page — render ONE demo page, store it as 4× tiles.
// The CRM's "Prepare demo" loop calls this per page (and again to re-capture updates).
async function preparePage(req, res) {
  const { starterId, path = '', viewportWidth, viewportHeight } = req.body || {};
  if (!starterId) return res.status(400).json({ error: 'starterId required' });
  if (!isCloudinaryConfigured()) return res.status(503).json({ error: 'Cloudinary is not configured.' });

  const { data: site, error } = await supabase
    .from('sites')
    .select('subdomain, custom_domain, status, metadata')
    .eq('id', starterId)
    .maybeSingle();
  if (error || !site) return res.status(404).json({ error: 'Demo site not found' });
  if (!site.metadata || !site.metadata.is_starter) return res.status(400).json({ error: 'Not a demo/Starter site' });

  const slug = String(path).replace(/^\/+/, '').trim();
  if (slug && !PAGE_SLUG_RE.test(slug)) return res.status(400).json({ error: 'Invalid page path' });
  const target = previewUrlFor(site) + (slug ? `/${slug}` : '');

  const width = Math.min(Math.max(Number(viewportWidth) || 1280, 320), 2048);
  const height = Math.min(Math.max(Number(viewportHeight) || 720, 480), 1440);
  const isMobile = width < 700;

  // Tile height in CSS px so each tile stays ≤ ~24MP at 4× (and under WebP's 16383 side).
  const tileCss = Math.min(3900, Math.max(240, Math.floor(24e6 / (MASTER_SCALE * MASTER_SCALE * width))));

  let browser;
  try {
    browser = await chromium.launch({ args: ['--no-sandbox'] });
    const page = await browser.newPage({ deviceScaleFactor: MASTER_SCALE, viewport: { width, height }, isMobile, hasTouch: isMobile });
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(800);
    await page
      .addStyleTag({ content: '[role="status"],[aria-label="Chat with us"]{display:none!important}' })
      .catch(() => {});
    // Scroll through so lazy-loaded images render, then settle back at the top.
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let y = 0;
        const step = () => {
          y += 600;
          window.scrollTo(0, y);
          if (y >= document.documentElement.scrollHeight) return resolve();
          setTimeout(step, 100);
        };
        step();
      });
    });
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400);

    const pageH = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));
    const capH = Math.min(pageH, tileCss * 12); // runaway-page backstop (~12 tiles)

    const tiles = [];
    for (let y = 0; y < capH; y += tileCss) {
      const h = Math.min(tileCss, capH - y);
      // fullPage:true → document-relative clip (see the region-commit note above).
      const png = await page.screenshot({ type: 'png', fullPage: true, clip: { x: 0, y, width, height: h } });
      const buf = await sharp(png).webp({ quality: 90 }).toBuffer();
      // Deterministic id per demo/page/device/tile + overwrite → re-capture replaces in place.
      const publicId = `${site.subdomain}--${(slug || 'home').replace(/\//g, '~')}--${width}x${height}--t${tiles.length}`;
      const uploaded = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: MASTERS_FOLDER, public_id: publicId, overwrite: true, invalidate: true, resource_type: 'image', format: 'webp' },
          (err, result) => (err ? reject(err) : resolve(result))
        );
        stream.end(buf);
      });
      tiles.push({ url: uploaded.secure_url, width: uploaded.width, height: uploaded.height });
    }
    await browser.close();
    browser = null;

    const key = masterKeyFor(slug, width, height);
    const entry = {
      tiles,
      width: tiles[0] ? tiles[0].width : width * MASTER_SCALE,
      height: tiles.reduce((s, t) => s + t.height, 0),
      scale: MASTER_SCALE,
      viewport: { width, height },
      pageCssHeight: pageH,
      truncated: capH < pageH,
      capturedAt: new Date().toISOString(),
    };

    // Record on the demo's metadata (read-modify-write; preserves every other key).
    const metaSite = await loadSiteMeta(starterId);
    const metadata = (metaSite && metaSite.metadata) || {};
    metadata.mockup_masters = { ...(metadata.mockup_masters || {}), [key]: entry };
    const { error: upErr } = await supabase.from('sites').update({ metadata }).eq('id', starterId);
    if (upErr) throw new Error(upErr.message);

    res.json({ key, master: entry });
  } catch (err) {
    if (browser) { try { await browser.close(); } catch { /* ignore */ } }
    console.error('mockup preparePage failed:', err.message);
    res.status(500).json({ error: err.message });
  }
}

// GET /api/admin/mockups/masters?starterId= — the demo's prepared-page tile map.
async function listMasters(req, res) {
  const { starterId } = req.query;
  if (!starterId) return res.status(400).json({ error: 'starterId required' });
  try {
    const site = await loadSiteMeta(starterId);
    if (!site) return res.status(404).json({ error: 'Demo site not found' });
    res.json({ masters: (site.metadata && site.metadata.mockup_masters) || {} });
  } catch (err) {
    console.error('mockup listMasters failed:', err.message);
    res.status(500).json({ error: err.message });
  }
}

// POST /api/admin/mockups/crop-master — cut a region out of a PREPARED page (no
// re-render): { starterId, page, viewportWidth, viewportHeight, clip } with clip in
// CSS px. Downloads only the overlapping tiles, sharp-stitches the region at 4×,
// uploads it to the sources library. ~3-6s vs ~15s for a live region re-capture.
async function cropMaster(req, res) {
  const { starterId, page = '', viewportWidth, viewportHeight, clip } = req.body || {};
  if (!starterId || !clip || typeof clip !== 'object') return res.status(400).json({ error: 'starterId + clip required' });
  if (!isCloudinaryConfigured()) return res.status(503).json({ error: 'Cloudinary is not configured.' });

  const slug = String(page).replace(/^\/+/, '').trim();
  if (slug && !PAGE_SLUG_RE.test(slug)) return res.status(400).json({ error: 'Invalid page path' });
  const width = Math.min(Math.max(Number(viewportWidth) || 1280, 320), 2048);
  const height = Math.min(Math.max(Number(viewportHeight) || 720, 480), 1440);

  try {
    const site = await loadSiteMeta(starterId);
    if (!site) return res.status(404).json({ error: 'Demo site not found' });
    const entry = site.metadata && site.metadata.mockup_masters && site.metadata.mockup_masters[masterKeyFor(slug, width, height)];
    if (!entry || !Array.isArray(entry.tiles) || !entry.tiles.length) {
      return res.status(404).json({ error: 'Page not prepared for this device — render or prepare it first.' });
    }

    const S = entry.scale || MASTER_SCALE;
    // Clip (CSS px) → master px, clamped to the stored surface.
    const rw = Math.min(Math.max(Math.round((clip.width || 0) * S), 16), entry.width);
    const rh = Math.min(Math.max(Math.round((clip.height || 0) * S), 16), entry.height);
    const rx = Math.min(Math.max(Math.round((clip.x || 0) * S), 0), entry.width - rw);
    const ry = Math.min(Math.max(Math.round((clip.y || 0) * S), 0), entry.height - rh);

    // Output fit: huge regions (e.g. the "Whole page" stitch feeding the Page-panels
    // scene) get downscaled to Cloudinary's ~25MP image cap + WebP's 16383px side —
    // normal card-sized crops pass through at fit=1 (full 4×).
    const fit = Math.min(1, Math.sqrt(24e6 / (rw * rh)), 16000 / rw, 16000 / rh);
    const outW = Math.max(16, Math.round(rw * fit));
    const outH = Math.max(16, Math.round(rh * fit));

    // Stitch the region from the overlapping tiles, scaling each part as it's cut
    // (never holds the full-res stitched page in memory). Part heights derive from
    // consecutive rounded offsets so scaled seams can't gap or overlap.
    const overlays = [];
    let acc = 0;
    for (const t of entry.tiles) {
      const top = acc;
      const bot = acc + t.height;
      acc = bot;
      const oy0 = Math.max(ry, top);
      const oy1 = Math.min(ry + rh, bot);
      if (oy1 <= oy0) continue;
      const d0 = Math.round((oy0 - ry) * fit);
      const d1 = Math.min(outH, Math.round((oy1 - ry) * fit));
      const partH = d1 - d0;
      if (partH < 1) continue;
      const resp = await fetch(t.url);
      if (!resp.ok) throw new Error(`tile fetch failed (${resp.status})`);
      const tbuf = Buffer.from(await resp.arrayBuffer());
      const cut = await sharp(tbuf)
        .extract({ left: rx, top: oy0 - top, width: rw, height: oy1 - oy0 })
        .resize({ width: outW, height: partH, fit: 'fill' })
        .toBuffer();
      overlays.push({ input: cut, left: 0, top: d0 });
    }
    const out = await sharp({ create: { width: outW, height: outH, channels: 3, background: '#ffffff' } })
      .composite(overlays)
      .webp({ quality: 92 })
      .toBuffer();

    const uploaded = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: SOURCES_FOLDER, resource_type: 'image', format: 'webp' },
        (err, result) => (err ? reject(err) : resolve(result))
      );
      stream.end(out);
    });
    res.json({ url: uploaded.secure_url, public_id: uploaded.public_id, width: uploaded.width, height: uploaded.height, bytes: uploaded.bytes, scale: Math.round(S * fit * 100) / 100 });
  } catch (err) {
    console.error('mockup cropMaster failed:', err.message);
    res.status(500).json({ error: err.message });
  }
}

// ── Saved mockups — persisted on the demo site's metadata.marketing_mockups ──
// Read-modify-write of the JSONB `sites.metadata` (preserving every other key).
async function loadSiteMeta(starterId) {
  const { data: site, error } = await supabase
    .from('sites')
    .select('metadata')
    .eq('id', starterId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return site; // null if not found
}

// GET /api/admin/mockups/saved?starterId= — the demo's saved mockups (newest-first order kept).
async function listSaved(req, res) {
  const { starterId } = req.query;
  if (!starterId) return res.status(400).json({ error: 'starterId required' });
  try {
    const site = await loadSiteMeta(starterId);
    if (!site) return res.status(404).json({ error: 'Demo site not found' });
    const mockups = (site.metadata && Array.isArray(site.metadata.marketing_mockups)) ? site.metadata.marketing_mockups : [];
    res.json({ mockups });
  } catch (err) {
    console.error('mockup listSaved failed:', err.message);
    res.status(500).json({ error: err.message });
  }
}

// POST /api/admin/mockups/save { starterId, mockup } — upsert one mockup by id (server-stamped).
async function saveMockup(req, res) {
  const { starterId, mockup } = req.body || {};
  if (!starterId || !mockup || typeof mockup !== 'object') return res.status(400).json({ error: 'starterId + mockup required' });
  try {
    const site = await loadSiteMeta(starterId);
    if (!site) return res.status(404).json({ error: 'Demo site not found' });
    const metadata = site.metadata || {};
    const list = Array.isArray(metadata.marketing_mockups) ? metadata.marketing_mockups.slice() : [];
    const now = new Date().toISOString();
    const idx = mockup.id ? list.findIndex((m) => m.id === mockup.id) : -1;
    let saved;
    if (idx >= 0) {
      saved = { ...list[idx], ...mockup, id: list[idx].id, updatedAt: now };
      list[idx] = saved;
    } else {
      saved = { ...mockup, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
      list.unshift(saved);
    }
    metadata.marketing_mockups = list;
    const { error: upErr } = await supabase.from('sites').update({ metadata }).eq('id', starterId);
    if (upErr) throw new Error(upErr.message);
    res.json({ mockup: saved, mockups: list });
  } catch (err) {
    console.error('mockup saveMockup failed:', err.message);
    res.status(500).json({ error: err.message });
  }
}

// POST /api/admin/mockups/delete-saved { starterId, id } — remove one saved mockup.
async function deleteSaved(req, res) {
  const { starterId, id } = req.body || {};
  if (!starterId || !id) return res.status(400).json({ error: 'starterId + id required' });
  try {
    const site = await loadSiteMeta(starterId);
    if (!site) return res.status(404).json({ error: 'Demo site not found' });
    const metadata = site.metadata || {};
    const list = (Array.isArray(metadata.marketing_mockups) ? metadata.marketing_mockups : []).filter((m) => m.id !== id);
    metadata.marketing_mockups = list;
    const { error: upErr } = await supabase.from('sites').update({ metadata }).eq('id', starterId);
    if (upErr) throw new Error(upErr.message);
    res.json({ mockups: list });
  } catch (err) {
    console.error('mockup deleteSaved failed:', err.message);
    res.status(500).json({ error: err.message });
  }
}

// GET /api/marketing/mockups — PUBLIC (no auth). The marketing site reads saved hero
// composites here, keyed by demo subdomain (newest saved mockup WITH a finalUrl per demo).
// Only demo/Starter sites carry marketing_mockups, so scope the scan to them.
async function marketingMockups(req, res) {
  try {
    const { data: sites, error } = await supabase
      .from('sites')
      .select('subdomain, metadata')
      .contains('metadata', { is_starter: true });
    if (error) throw new Error(error.message);
    const byDomain = {};
    for (const s of sites || []) {
      const list = s.metadata && s.metadata.marketing_mockups;
      if (!Array.isArray(list)) continue;
      for (const m of list) {
        if (!m.finalUrl) continue;
        const prev = byDomain[s.subdomain];
        if (!prev || String(m.updatedAt || '') > String(prev.updatedAt || '')) {
          byDomain[s.subdomain] = { subdomain: s.subdomain, url: m.finalUrl, scene: m.scene || null, sceneLabel: m.sceneLabel || null, updatedAt: m.updatedAt || null };
        }
      }
    }
    res.json({ mockups: Object.values(byDomain) });
  } catch (err) {
    console.error('marketingMockups failed:', err.message);
    res.status(500).json({ error: err.message });
  }
}

module.exports = { capture, listAssets, uploadAsset, deleteAsset, screenshotDemo, preparePage, listMasters, cropMaster, listSaved, saveMockup, deleteSaved, marketingMockups };
