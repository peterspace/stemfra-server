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
const leadgenRoutes    = require('./routes/leadgen');
const speedToLeadRoutes = require('./routes/speedToLead');
const siteFormsRoutes   = require('./routes/siteForms');
const siteBookingsRoutes = require('./routes/siteBookings');
const sitePaymentsRoutes = require('./routes/sitePayments');
const platformBillingRoutes = require('./routes/platformBilling');
const siteMembershipsRoutes = require('./routes/siteMemberships');
const siteMembersRoutes = require('./routes/siteMembers');
const cmsMembershipPlansRouter = require('./routes/cms/membershipPlans');
const cmsSubscriptionsRouter = require('./routes/cms/subscriptions');
const cmsRefundsRouter = require('./routes/cms/refunds');
const cmsActivityRouter = require('./routes/cms/activity');
const cmsCustomersRouter = require('./routes/cms/customers');
const cmsSiteUploadsRouter = require('./routes/cms/siteUploads');
const cmsPaymentsRouter = require('./routes/cms/payments');
const busboy = require('connect-busboy');
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
  'http://localhost:5174',   // stemfra_barbers template (dev)
  'http://localhost:5175',   // stemfra_salons template (dev)
  'http://localhost:5176',   // stemfra_crossfit template (dev)
  'http://localhost:5177',   // stemfra_yoga template (dev)
  'http://localhost:5180',   // stemfra_cms (dev)
];

app.use(cors({
  origin:         allowedOrigins,
  methods:        ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials:    true,
}));

// Stripe webhook MUST be registered before express.json() — signature
// verification needs the raw, unparsed request body.
app.use('/api/stripe/webhook', express.raw({ type: '*/*' }), require('./routes/stripeWebhook'));

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false }));
app.use(busboy({ limits: { files: 1, fileSize: 105 * 1024 * 1024 } })); // 105MB headroom over the 100MB video cap; 30MB image cap also fits

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
app.use('/api/leadgen',       leadgenRoutes);
app.use('/api/speed-to-lead', speedToLeadRoutes);
app.use('/api/site-forms',    siteFormsRoutes);
app.use('/api/site-bookings', siteBookingsRoutes);
app.use('/api/site-payments', sitePaymentsRoutes);
app.use('/api/platform-billing', platformBillingRoutes);
app.use('/api/site-memberships', siteMembershipsRoutes);
app.use('/api/site-members', siteMembersRoutes);
app.use('/api/cms/membership-plans', cmsMembershipPlansRouter);
app.use('/api/cms/subscriptions', cmsSubscriptionsRouter);
app.use('/api/cms/refunds', cmsRefundsRouter);
app.use('/api/cms/activity', cmsActivityRouter);
app.use('/api/cms/customers', cmsCustomersRouter);
app.use('/api/cms/site-uploads', cmsSiteUploadsRouter);
app.use('/api/cms/payments', cmsPaymentsRouter);

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
