// Global error handler — mounted last in index.js
const errorHandler = (err, req, res, next) => {
  console.error('[Error]', err.stack);
  const status = err.statusCode || 500;
  res.status(status).json({
    success: false,
    message: err.message || 'Internal server error.',
  });
};

// 404 handler — mounted before errorHandler
const notFound = (req, res, next) => {
  res.status(404).json({ success: false, message: `Route not found: ${req.originalUrl}` });
};

module.exports = { errorHandler, notFound };
