const supabase = require('../config/supabase');

// Columns returned in the list view (full content excluded).
const LIST_COLUMNS = 'id, slug, title, excerpt, category, read_time, image, published, published_at, created_at, updated_at';

// camelCase ↔ snake_case helpers — stemfra_client expects camelCase fields.
function toCamel(row) {
  if (!row) return row;
  const { read_time, published_at, created_at, updated_at, ...rest } = row;
  return {
    ...rest,
    readTime:    read_time,
    publishedAt: published_at,
    createdAt:   created_at,
    updatedAt:   updated_at,
  };
}

function toSnake(payload = {}) {
  const out = { ...payload };
  if ('readTime' in out)    { out.read_time    = out.readTime;    delete out.readTime; }
  if ('publishedAt' in out) { out.published_at = out.publishedAt; delete out.publishedAt; }
  // never accept caller-supplied id / timestamps for create/update
  delete out.id;
  delete out.createdAt;
  delete out.updatedAt;
  delete out.created_at;
  delete out.updated_at;
  return out;
}

// ─── GET /api/insights ────────────────────────────────────────────────────────
const getInsights = async (req, res) => {
  try {
    const { category, limit } = req.query;

    let query = supabase
      .from('articles')
      .select(LIST_COLUMNS)
      .eq('published', true)
      .order('published_at', { ascending: false });

    if (category) query = query.ilike('category', category);

    const parsedLimit = parseInt(limit, 10);
    if (!isNaN(parsedLimit)) query = query.limit(parsedLimit);

    const { data, error } = await query;
    if (error) throw error;

    const articles = data.map(toCamel);
    return res.status(200).json({ success: true, count: articles.length, data: articles });
  } catch (err) {
    console.error('[insightsController] getInsights error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to fetch insights.' });
  }
};

// ─── GET /api/insights/:slug ──────────────────────────────────────────────────
const getInsight = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('articles')
      .select('*')
      .eq('slug', req.params.slug)
      .eq('published', true)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: 'Article not found.' });
    }

    return res.status(200).json({ success: true, data: toCamel(data) });
  } catch (err) {
    console.error('[insightsController] getInsight error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to fetch article.' });
  }
};

// ─── POST /api/insights — create article (admin use) ─────────────────────────
const createInsight = async (req, res) => {
  try {
    const payload = toSnake(req.body);

    const { data, error } = await supabase
      .from('articles')
      .insert([payload])
      .select()
      .single();

    if (error) {
      // Postgres unique_violation
      if (error.code === '23505') {
        return res.status(400).json({ success: false, message: 'An article with this slug already exists.' });
      }
      return res.status(400).json({ success: false, message: error.message });
    }

    return res.status(201).json({ success: true, data: toCamel(data) });
  } catch (err) {
    console.error('[insightsController] createInsight error:', err.message);
    return res.status(400).json({ success: false, message: err.message });
  }
};

// ─── PATCH /api/insights/:slug — update article (admin use) ──────────────────
const updateInsight = async (req, res) => {
  try {
    const payload = toSnake(req.body);

    const { data, error } = await supabase
      .from('articles')
      .update(payload)
      .eq('slug', req.params.slug)
      .select()
      .maybeSingle();

    if (error) {
      if (error.code === '23505') {
        return res.status(400).json({ success: false, message: 'An article with this slug already exists.' });
      }
      return res.status(400).json({ success: false, message: error.message });
    }
    if (!data) {
      return res.status(404).json({ success: false, message: 'Article not found.' });
    }

    return res.status(200).json({ success: true, data: toCamel(data) });
  } catch (err) {
    console.error('[insightsController] updateInsight error:', err.message);
    return res.status(400).json({ success: false, message: err.message });
  }
};

// ─── DELETE /api/insights/:slug — delete article (admin use) ─────────────────
const deleteInsight = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('articles')
      .delete()
      .eq('slug', req.params.slug)
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, message: 'Article not found.' });
    }

    return res.status(200).json({ success: true, message: 'Article deleted.' });
  } catch (err) {
    console.error('[insightsController] deleteInsight error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to delete article.' });
  }
};

module.exports = { getInsights, getInsight, createInsight, updateInsight, deleteInsight };
