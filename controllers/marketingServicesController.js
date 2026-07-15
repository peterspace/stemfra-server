// Public marketing-site read: a demo site's service menu, for the Solutions
// pages' Bentley-style services marquee. Keyed by demo SUBDOMAIN (the client
// already resolves the vertical's Featured demo via /api/starters), and gated
// to Starter/demo sites only — same SSRF-safe pattern as screenshotDemo.
//
// NOTE: config/supabase.js exports the client directly (single-var require).
const supabase = require('../config/supabase');

const i18n = (v) => (typeof v === 'string' ? v : v?.en ?? null);

// GET /api/marketing/demo-services?subdomain=argyle-and-sons
async function demoServices(req, res) {
  try {
    const subdomain = String(req.query.subdomain || '').trim().toLowerCase();
    if (!/^[a-z0-9-]{1,63}$/.test(subdomain)) {
      return res.status(400).json({ error: 'subdomain required' });
    }

    const { data: site, error } = await supabase
      .from('sites')
      .select('id, metadata')
      .eq('subdomain', subdomain)
      .maybeSingle();
    if (error) throw error;
    if (!site || !site.metadata?.is_starter) {
      return res.status(404).json({ error: 'Demo site not found' });
    }

    const { data: rows, error: svcErr } = await supabase
      .from('site_services')
      .select('name, description, photo_url, price_cents, price_display_mode, duration_minutes, display_order')
      .eq('site_id', site.id)
      .eq('is_active', true)
      .order('display_order', { ascending: true })
      .limit(16);
    if (svcErr) throw svcErr;

    const services = (rows || [])
      .filter((s) => s.photo_url) // the marquee is visual — photo-less rows would render blank cards
      .map((s) => ({
        name: i18n(s.name),
        description: i18n(s.description),
        photoUrl: s.photo_url,
        priceCents: s.price_cents,
        priceDisplayMode: s.price_display_mode,
        durationMinutes: s.duration_minutes,
      }));

    res.set('Cache-Control', 'public, max-age=300');
    res.json({ subdomain, services });
  } catch (err) {
    console.error('marketing demoServices failed:', err.message);
    res.status(500).json({ error: err.message });
  }
}

module.exports = { demoServices };
