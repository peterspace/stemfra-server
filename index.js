require('dotenv').config();

const express          = require('express');
const cors             = require('cors');
require('./config/supabase'); // initialise + validate env vars at boot
const contactRoutes    = require('./routes/contact');
const insightsRoutes   = require('./routes/insights');
const twilioRoutes     = require('./routes/twilio');
const userSettingsRoutes = require('./routes/userSettings');
const presenceRoutes   = require('./routes/presence');
const { startStalePresenceSweeper } = require('./routes/presence');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app  = express();
const PORT = process.env.PORT || 4000;

// ─── Middleware ───────────────────────────────────────────────────────────────
const allowedOrigins = [
  process.env.CLIENT_URL || 'http://localhost:5173',
  // Production frontends
  'https://stemfra.com',         // stemfra_client (apex)
  'https://www.stemfra.com',     // stemfra_client (www)
  'https://crm.stemfra.com',     // stemfra_ops (CRM)
  // Local dev (kept in prod too so devs can hit api.stemfra.com from
  // localhost:5173 — only ever exploitable from the dev's own machine).
  'http://localhost:5173',
];

app.use(cors({
  origin:         allowedOrigins,
  methods:        ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials:    true,
}));

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false }));

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.status(200).json({
    status:    'ok',
    server:    'STEMfra API',
    timestamp: new Date().toISOString(),
  });
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/contact',  contactRoutes);
app.use('/api/insights', insightsRoutes);
app.use('/api/twilio',        twilioRoutes);
app.use('/api/user-settings', userSettingsRoutes);
app.use('/api/presence',      presenceRoutes);

// Dev-only: in-browser email template previews
if (process.env.NODE_ENV !== 'production') {
  app.use('/dev/preview', require('./routes/devPreview'));
}

// ─── Error handling ───────────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ─── Start server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✓ STEMfra server running on http://localhost:${PORT}`);
  // Flip stale user_presence rows to offline once a minute. Browsers don't
  // reliably fire the offline beacon on tab close, so this is the fallback.
  startStalePresenceSweeper();
});
