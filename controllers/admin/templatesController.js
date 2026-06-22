// Staff template-catalog admin (CRM "Templates" page). Manages the `templates`
// rows that define each vertical's themes — which are active (shown in the CMS
// theme picker), which is the per-vertical default, ordering, and name/desc.
// Does NOT edit design_tokens/archetype_variants (that's the THEME_CONTRACT
// theme-building surface, a later/bigger wave). Staff-gated via requireStaffAuth.
const supabase = require('../../config/supabase');

// GET /api/admin/templates — every template, with vertical + sites-using count.
async function listTemplates(req, res) {
  try {
    const { data, error } = await supabase
      .from('templates')
      .select('id, slug, display_name, description, is_active, is_default, display_order, preview_image_url, vertical:verticals(id, slug, display_name, display_order)')
      .order('display_order');
    if (error) throw new Error(error.message);

    const { data: sites } = await supabase.from('sites').select('template_id');
    const counts = {};
    (sites || []).forEach((s) => { if (s.template_id) counts[s.template_id] = (counts[s.template_id] || 0) + 1; });

    const templates = (data || []).map((t) => ({
      id: t.id,
      slug: t.slug,
      displayName: t.display_name,
      description: t.description,
      isActive: t.is_active,
      isDefault: t.is_default,
      displayOrder: t.display_order,
      previewImageUrl: t.preview_image_url,
      verticalId: t.vertical?.id,
      vertical: t.vertical?.display_name || t.vertical?.slug || '—',
      verticalSlug: t.vertical?.slug,
      verticalOrder: t.vertical?.display_order ?? 99,
      sitesUsing: counts[t.id] || 0,
    }));
    res.json({ templates });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// PATCH /api/admin/templates/:id — update name/description/active/order.
async function updateTemplate(req, res) {
  try {
    const allowed = ['display_name', 'description', 'is_active', 'display_order'];
    const updates = {};
    for (const k of allowed) if (k in (req.body || {})) updates[k] = req.body[k];
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'No updatable fields provided.' });

    // Guard: don't deactivate a template that's the active default or in use,
    // unless explicitly forced — avoids stranding a vertical with no default.
    if (updates.is_active === false) {
      const { data: t } = await supabase.from('templates').select('is_default, vertical_id').eq('id', req.params.id).single();
      if (t?.is_default) return res.status(409).json({ error: 'This is the default — set another template as default before deactivating it.', code: 'is_default' });
      const { count } = await supabase.from('sites').select('id', { count: 'exact', head: true }).eq('template_id', req.params.id);
      if (count > 0 && !req.body.force) return res.status(409).json({ error: `${count} site(s) use this template — deactivating hides it from the picker (existing sites keep rendering). Pass force to confirm.`, code: 'in_use' });
    }

    const { data, error } = await supabase.from('templates').update(updates).eq('id', req.params.id).select().single();
    if (error) throw new Error(error.message);
    res.json({ ok: true, template: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/admin/templates/:id/set-default — exclusive default within the vertical.
async function setDefault(req, res) {
  try {
    const { data: t } = await supabase.from('templates').select('id, vertical_id, is_active').eq('id', req.params.id).single();
    if (!t) return res.status(404).json({ error: 'Template not found.' });
    if (!t.is_active) return res.status(409).json({ error: 'Activate the template before making it the default.', code: 'inactive' });
    await supabase.from('templates').update({ is_default: false }).eq('vertical_id', t.vertical_id);
    const { error } = await supabase.from('templates').update({ is_default: true }).eq('id', req.params.id);
    if (error) throw new Error(error.message);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { listTemplates, updateTemplate, setDefault };
