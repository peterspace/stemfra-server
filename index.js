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
const { startOutreachReplySweeper } = require('./lib/outreachReplySweeper');
const { startBillingCycleSweeper } = require('./lib/billingCycleSweeper');
const { startSiteDeletionSweeper } = require('./lib/siteDeletionSweeper');
const { startOutreachSequencer } = require('./lib/outreachSequencer');
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
const cmsPublishRouter = require('./routes/cms/publish');
const cmsSiteDomainRouter = require('./routes/cms/siteDomain');
const cmsSitesRouter = require('./routes/cms/sites');
const cmsAssistantRouter = require('./routes/cms/assistant');
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
  'http://localhost:5181',   // stemfra_massage template (dev)
  'http://localhost:5182',   // stemfra_spa template (dev — built after massage)
  'http://localhost:5180',   // stemfra_cms (dev)
  'http://localhost:5178',   // stemfra-ops CRM (dev)
];

// Pattern-matched origins for the multi-tenant Cloudflare Pages deployments.
// The deployed template/CMS sites live on hosts that can't be listed
// statically, so we match them by shape:
//   - stemfra-<app>.pages.dev and <hash>.stemfra-<app>.pages.dev  (our Pages
//     projects + their preview deployments — scoped to OUR project names so a
//     random *.pages.dev site can't use the API)
//   - any *.stemfra.com subdomain (apex/www/crm/cms + customer sites, Phase 2)
// Customer CUSTOM domains (their own TLDs) are a Phase-2 addition: they'll be
// loaded from the live `sites` table into a cached allowlist and checked here.
// Until then a custom-domain site can still READ (Supabase anon is permissive),
// but its server-backed forms/bookings need its origin added below.
const allowedOriginPatterns = [
  /^https:\/\/([a-z0-9-]+\.)?stemfra-(barbers|salons|crossfit|yoga|cms)\.pages\.dev$/i,
  /^https:\/\/([a-z0-9-]+\.)*stemfra\.com$/i,
];

function corsOrigin(origin, callback) {
  // No Origin header → non-browser caller (curl, server-to-server, Twilio
  // webhooks, health probes). CORS doesn't apply; allow.
  if (!origin) return callback(null, true);
  if (allowedOrigins.includes(origin)) return callback(null, true);
  if (allowedOriginPatterns.some((re) => re.test(origin))) return callback(null, true);
  // Disallowed: reject without an Error so the preflight returns a clean
  // response (no Access-Control-Allow-Origin → the browser blocks it) instead
  // of a 500 that floods the error log on every bot/scanner probe.
  return callback(null, false);
}

app.use(cors({
  origin:         corsOrigin,
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
app.use('/api/onboarding', require('./routes/onboarding'));
app.use('/api/starters',   require('./routes/starters'));   // public Starter catalog (clone-to-onboard)
app.use('/api/marketing',  require('./routes/marketing'));  // public marketing-site reads (hero mockups)
app.use('/api/insights', insightsRoutes);
app.use('/api/plans',    require('./routes/plans'));   // public pricing catalog (single source)
app.use('/api/twilio',        twilioRoutes);
app.use('/api/user-settings', userSettingsRoutes);
app.use('/api/presence',      presenceRoutes);
app.use('/api/leadgen',       leadgenRoutes);
app.use('/api/speed-to-lead', speedToLeadRoutes);
app.use('/api/site-forms',    siteFormsRoutes);
app.use('/api/site-chat',     require('./routes/siteChat'));
app.use('/api/concierge',     require('./routes/concierge'));
app.use('/api/voice',         require('./routes/voice'));
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
app.use('/api/cms/site-publish', cmsPublishRouter);
app.use('/api/cms/site-domain', cmsSiteDomainRouter);
app.use('/api/cms/sites', cmsSitesRouter);
app.use('/api/cms/billing', require('./routes/cms/billing'));
app.use('/api/cms/assistant', cmsAssistantRouter);
app.use('/api/admin/sites', require('./routes/admin/sites'));
app.use('/api/admin/domains', require('./routes/admin/domains'));
app.use('/api/admin/templates', require('./routes/admin/templates'));
app.use('/api/admin/subscriptions', require('./routes/admin/subscriptions'));
app.use('/api/admin/billing', require('./routes/admin/billing'));
app.use('/api/admin/bookings', require('./routes/admin/bookings'));
app.use('/api/admin/memberships', require('./routes/admin/memberships'));
app.use('/api/admin/mockups', require('./routes/admin/mockups'));

// Dev-only: in-browser email template previews
if (process.env.NODE_ENV !== 'production') {
  app.use('/dev/preview', require('./routes/devPreview'));
}

// ─── Error handling ───────────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ─── Start server ─────────────────────────────────────────────────────────────
// HTTP + WebSocket (the WS server carries Twilio ConversationRelay live audio for
// Stemfra Voice — attached to the same port so it shares the public host/TLS).
const http = require('http');
const { attachVoiceRelay } = require('./controllers/voiceController');
const server = http.createServer(app);
attachVoiceRelay(server);
server.listen(PORT, () => {
  console.log(`✓ STEMfra server running on http://localhost:${PORT}`);
  // Flip stale user_presence rows to offline once a minute. Browsers don't
  // reliably fire the offline beacon on tab close, so this is the fallback.
  startStalePresenceSweeper();
  // Lead-gen Phase 2: poll sent-outreach Gmail threads for replies → flip leads
  // warm. Idle (no-op) until the Google service account is configured.
  startOutreachReplySweeper();
  // System A billing: open one recurring charge per active manual-provider
  // subscription per calendar month (Payoneer etc.; Stripe self-bills).
  startBillingCycleSweeper();
  // Site deletion: hard-purge sites that have been soft-deleted past the 90-day
  // grace window (Cloudinary media + all DB rows). See lib/siteDeletion.js.
  startSiteDeletionSweeper();
  // Lead-gen follow-up sequencer (A2 → read-gated call → A8 → A20). Inert until
  // crm_settings.leadgen_sequencer.enabled = true.
  startOutreachSequencer();
});
