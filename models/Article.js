const mongoose = require('mongoose');

// ─── Content block sub-schema ─────────────────────────────────────────────────
// Mirrors the local articles.js structure exactly so the Insights page
// works identically whether data comes from the API or the local fallback.
const ContentBlockSchema = new mongoose.Schema(
  {
    type:  { type: String, enum: ['paragraph', 'heading', 'list', 'quote', 'image'], required: true },
    text:  { type: String },          // paragraph, heading, quote
    items: { type: [String] },        // list
    src:   { type: String },          // image
    alt:   { type: String },          // image
  },
  { _id: false }
);

const ArticleSchema = new mongoose.Schema(
  {
    // slug — used as the URL param e.g. /insights/venture-studio-model
    slug: {
      type: String,
      required: [true, 'Slug is required'],
      unique: true,
      trim: true,
      lowercase: true,
      match: [/^[a-z0-9-]+$/, 'Slug may only contain lowercase letters, numbers and hyphens'],
    },
    title: {
      type: String,
      required: [true, 'Title is required'],
      trim: true,
      maxlength: 200,
    },
    excerpt: {
      type: String,
      required: [true, 'Excerpt is required'],
      trim: true,
      maxlength: 500,
    },
    category: {
      type: String,
      required: [true, 'Category is required'],
      trim: true,
    },
    readTime: {
      type: String,
      default: '5 min read',
    },
    image: {
      type: String,      // URL — Unsplash, CDN, or uploaded asset path
      default: '',
    },
    content: {
      type: [ContentBlockSchema],
      default: [],
    },
    published: {
      type: Boolean,
      default: true,     // false = draft, hidden from public API
    },
    publishedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

// Index for fast slug lookups and category filtering
ArticleSchema.index({ slug: 1 });
ArticleSchema.index({ published: 1, publishedAt: -1 });

module.exports = mongoose.model('Article', ArticleSchema);
