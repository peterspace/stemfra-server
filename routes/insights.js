const express = require('express');
const router  = express.Router();

const {
  getInsights,
  getInsight,
  createInsight,
  updateInsight,
  deleteInsight,
} = require('../controllers/insightsController');

// Public routes
router.get('/',       getInsights);   // GET  /api/insights
router.get('/:slug',  getInsight);    // GET  /api/insights/:slug

// Admin / internal routes (auth middleware can be added here later)
router.post('/',          createInsight);   // POST   /api/insights
router.patch('/:slug',    updateInsight);   // PATCH  /api/insights/:slug
router.delete('/:slug',   deleteInsight);   // DELETE /api/insights/:slug

module.exports = router;
