// Server-side document export for the stemfra_business app (staff-only, :5183).
// The browser sends the EXACT HTML + collected CSS it renders, and headless
// Chromium (Playwright — already a dependency via the CRM mockups) produces:
//   POST /api/export/pdf     → a real, selectable-text PDF via page.pdf()
//                              (consistent margins on every page via CSS @page,
//                              zero browser header/footer junk)
//   POST /api/export/images  → one retina PNG per page via page.screenshot()
//                              (the client embeds them into PPTX/DOCX)
// This is the "same UI as the browser" guarantee: Chrome lays the document out
// with the app's own stylesheets + Google-Fonts @imports, so the export is
// pixel-identical to the on-screen render — unlike html2canvas (approximate)
// or pdfmake (a re-layout in Roboto).
//
// Mounted BEFORE the global express.json({ limit: '10kb' }) (Stripe-webhook
// precedent) because HTML+CSS payloads run to a few MB.
const express = require('express');
const router = express.Router();
const { chromium } = require('playwright');
const { requireStaffAuth } = require('../middleware/staffAuth');

router.use(express.json({ limit: '60mb' }));

const NAV_TIMEOUT = 60_000;

async function withPage(viewport, scale, fn) {
  let browser;
  try {
    browser = await chromium.launch({ args: ['--no-sandbox'] });
    const page = await browser.newPage({
      viewport,
      deviceScaleFactor: scale,
    });
    page.setDefaultTimeout(NAV_TIMEOUT);
    return await fn(page);
  } finally {
    if (browser) { try { await browser.close(); } catch { /* ignore */ } }
  }
}

async function renderContent(page, html) {
  // networkidle waits for images/fonts/stylesheets the doc references
  // (base-href-relative assets from :5183, Cloudinary, Google Fonts).
  await page.setContent(html, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT });
  await page.evaluate(() => document.fonts ? document.fonts.ready : true);
}

// POST /api/export/pdf
// Body: { html, pdf?: { format?, width?, height?, margin?, landscape?,
//                       preferCSSPageSize? } }
router.post('/pdf', requireStaffAuth, async (req, res) => {
  const { html, pdf = {} } = req.body || {};
  if (!html || typeof html !== 'string') {
    return res.status(400).json({ error: 'html (string) is required' });
  }
  try {
    const buf = await withPage({ width: 1280, height: 800 }, 1, async (page) => {
      await renderContent(page, html);
      return page.pdf({ printBackground: true, timeout: NAV_TIMEOUT, ...pdf });
    });
    res.type('application/pdf').send(buf);
  } catch (err) {
    console.error('[export/pdf] failed:', err.message);
    res.status(500).json({ error: `PDF render failed: ${err.message}` });
  }
});

// POST /api/export/images
// Body: { pages: [html, ...], viewport?: { width, height }, scale? }
// → { images: ['data:image/png;base64,...', ...] } in the same order.
router.post('/images', requireStaffAuth, async (req, res) => {
  const { pages, viewport = { width: 1920, height: 1080 }, scale = 2 } = req.body || {};
  if (!Array.isArray(pages) || pages.length === 0 || pages.length > 60) {
    return res.status(400).json({ error: 'pages (array of html, 1-60) is required' });
  }
  try {
    const images = await withPage(viewport, Math.min(3, Math.max(1, scale)), async (page) => {
      const out = [];
      for (const html of pages) {
        await renderContent(page, html);
        const png = await page.screenshot({
          type: 'png',
          clip: { x: 0, y: 0, width: viewport.width, height: viewport.height },
        });
        out.push(`data:image/png;base64,${png.toString('base64')}`);
      }
      return out;
    });
    res.json({ images });
  } catch (err) {
    console.error('[export/images] failed:', err.message);
    res.status(500).json({ error: `Image render failed: ${err.message}` });
  }
});

// GET /api/export/healthcheck — is Chromium launchable?
router.get('/healthcheck', async (_req, res) => {
  try {
    await withPage({ width: 8, height: 8 }, 1, async () => true);
    res.json({ ok: true });
  } catch (err) {
    res.status(503).json({ ok: false, error: err.message });
  }
});

module.exports = router;
