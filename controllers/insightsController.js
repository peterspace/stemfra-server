const Article = require('../models/Article');

// ─── GET /api/insights ────────────────────────────────────────────────────────
// Returns all published articles, newest first.
// Optional query params:
//   ?category=Fintech   — filter by category
//   ?limit=6            — limit results (default: all)
const getInsights = async (req, res) => {
  try {
    const { category, limit } = req.query;

    const filter = { published: true };
    if (category) filter.category = { $regex: new RegExp(`^${category}$`, 'i') };

    let query = Article.find(filter)
      .sort({ publishedAt: -1 })
      .select('-content -__v'); // exclude full content from list view

    if (limit && !isNaN(parseInt(limit))) {
      query = query.limit(parseInt(limit));
    }

    const articles = await query;

    return res.status(200).json({ success: true, count: articles.length, data: articles });
  } catch (err) {
    console.error('[insightsController] getInsights error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to fetch insights.' });
  }
};

// ─── GET /api/insights/:slug ──────────────────────────────────────────────────
// Returns a single published article by slug, including full content.
const getInsight = async (req, res) => {
  try {
    const article = await Article.findOne({
      slug: req.params.slug,
      published: true,
    }).select('-__v');

    if (!article) {
      return res.status(404).json({ success: false, message: 'Article not found.' });
    }

    return res.status(200).json({ success: true, data: article });
  } catch (err) {
    console.error('[insightsController] getInsight error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to fetch article.' });
  }
};

// ─── POST /api/insights — create article (admin use) ─────────────────────────
const createInsight = async (req, res) => {
  try {
    const article = await Article.create(req.body);
    return res.status(201).json({ success: true, data: article });
  } catch (err) {
    console.error('[insightsController] createInsight error:', err.message);
    // Duplicate slug
    if (err.code === 11000) {
      return res.status(400).json({ success: false, message: 'An article with this slug already exists.' });
    }
    return res.status(400).json({ success: false, message: err.message });
  }
};

// ─── PATCH /api/insights/:slug — update article (admin use) ──────────────────
const updateInsight = async (req, res) => {
  try {
    const article = await Article.findOneAndUpdate(
      { slug: req.params.slug },
      req.body,
      { new: true, runValidators: true }
    );
    if (!article) {
      return res.status(404).json({ success: false, message: 'Article not found.' });
    }
    return res.status(200).json({ success: true, data: article });
  } catch (err) {
    console.error('[insightsController] updateInsight error:', err.message);
    return res.status(400).json({ success: false, message: err.message });
  }
};

// ─── DELETE /api/insights/:slug — delete article (admin use) ─────────────────
const deleteInsight = async (req, res) => {
  try {
    const article = await Article.findOneAndDelete({ slug: req.params.slug });
    if (!article) {
      return res.status(404).json({ success: false, message: 'Article not found.' });
    }
    return res.status(200).json({ success: true, message: 'Article deleted.' });
  } catch (err) {
    console.error('[insightsController] deleteInsight error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to delete article.' });
  }
};

module.exports = { getInsights, getInsight, createInsight, updateInsight, deleteInsight };
