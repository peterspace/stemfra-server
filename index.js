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
const { startCommissionScheduler } = require('./lib/commissionScheduler');
const { startBillingCycleSweeper } = require('./lib/billingCycleSweeper');
const { startSiteDeletionSweeper } = require('./lib/siteDeletionSweeper');
const { startBookingReminderSweeper } = require('./lib/bookingReminderSweeper');
const { startLifecycleSweeper } = require('./lib/lifecycleSweeper');
const { startMembershipRenewalSweeper } = require('./lib/membershipRenewalSweeper');
const { startBookingCheckoutSweeper } = require('./lib/bookingCheckoutSweeper');
const { startBookingAutoCollectSweeper } = require('./lib/bookingAutoCollectSweeper');
const { startDomainRenewalSweeper } = require('./lib/domainRenewalSweeper');
const { startNexusSweeper } = require('./lib/nexusSweeper');
const { startReconSweeper } = require('./lib/reconSweeper');
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
const cmsSmsConsentRouter = require('./routes/cms/smsConsent');
const cmsSubscriptionsRouter = require('./routes/cms/subscriptions');
const cmsRefundsRouter = require('./routes/cms/refunds');
const cmsActivityRouter = require('./routes/cms/activity');
const cmsCustomersRouter = require('./routes/cms/customers');
const cmsSiteUploadsRouter = require('./routes/cms/siteUploads');
const cmsPaymentsRouter = require('./routes/cms/payments');
const cmsPublishRouter = require('./routes/cms/publish');
const cmsSiteDomainRouter = require('./routes/cms/siteDomain');
const cmsSiteEmailRouter = require('./routes/cms/siteEmail');
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
  'http://localhost:5183',   // stemfra_business (dev — plans & pitch decks)
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
// Airwallex deposit webhook (recon) — same raw-body requirement for HMAC verify.
app.use('/api/awx/webhook', express.raw({ type: '*/*' }), require('./routes/awxWebhook'));

// Document export (stemfra_business, staff-only) — registered before the global
// 10kb json parser because it receives multi-MB HTML+CSS payloads; the route
// carries its own express.json({ limit: '60mb' }).
app.use('/api/export', require('./routes/export'));

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
app.use('/api/setup-call', require('./routes/setupCall'));  // public: marketing "Book a setup call" (video + Meet)
app.use('/api/starters',   require('./routes/starters'));   // public Starter catalog (clone-to-onboard)
app.use('/api/marketing',  require('./routes/marketing'));  // public marketing-site reads (hero mockups)
app.use('/api/insights', insightsRoutes);
app.use('/api/plans',    require('./routes/plans'));   // public pricing catalog (single source)
const publicConfigRouter = require('./routes/publicConfig');
app.use('/api/public-config', publicConfigRouter);
app.use('/api/business', require('./routes/business')); // stemfra_business app: AI drafting copilot (staff-only)
app.use('/api/twilio',        twilioRoutes);
app.use('/api/user-settings', userSettingsRoutes);
app.use('/api/presence',      presenceRoutes);
app.use('/api/leadgen',       leadgenRoutes);
app.use('/api/speed-to-lead', speedToLeadRoutes);
app.use('/api/site-forms',    siteFormsRoutes);
app.use('/api/site-emails',   require('./routes/emailPrefs'));
app.use('/api/site-chat',     require('./routes/siteChat'));
app.use('/api/concierge',     require('./routes/concierge'));
app.use('/api/voice',         require('./routes/voice'));
app.use('/api/site-bookings', siteBookingsRoutes);
app.use('/api/site-payments', sitePaymentsRoutes);
app.use('/api/platform-billing', platformBillingRoutes);
app.use('/api/site-memberships', siteMembershipsRoutes);
app.use('/api/site-members', siteMembersRoutes);
app.use('/api/cms/membership-plans', cmsMembershipPlansRouter);
app.use('/api/cms/sms-consent', cmsSmsConsentRouter);
app.use('/api/cms/subscriptions', cmsSubscriptionsRouter);
app.use('/api/cms/refunds', cmsRefundsRouter);
app.use('/api/cms/activity', cmsActivityRouter);
app.use('/api/cms/customers', cmsCustomersRouter);
app.use('/api/cms/site-uploads', cmsSiteUploadsRouter);
app.use('/api/cms/payments', cmsPaymentsRouter);
app.use('/api/cms/site-publish', cmsPublishRouter);
app.use('/api/cms/site-domain', cmsSiteDomainRouter);
app.use('/api/cms/site-email', cmsSiteEmailRouter);
app.use('/api/cms/bookings', require('./routes/cms/bookings'));
app.use('/api/cms/leads', require('./routes/cms/leads'));
app.use('/api/cms/email-templates', require('./routes/cms/emailTemplates'));
app.use('/api/cms/google-profile', require('./routes/cms/googleProfile'));
app.use('/api/cms/reports', require('./routes/cms/reports'));
app.use('/api/cms/sites', cmsSitesRouter);
app.use('/api/cms/billing', require('./routes/cms/billing'));
app.use('/api/cms/support', require('./routes/cms/support'));
app.use('/api/cms/assistant', cmsAssistantRouter);
app.use('/api/admin/sites', require('./routes/admin/sites'));
app.use('/api/admin/domains', require('./routes/admin/domains'));
app.use('/api/admin/templates', require('./routes/admin/templates'));
app.use('/api/admin/subscriptions', require('./routes/admin/subscriptions'));
app.use('/api/admin/billing', require('./routes/admin/billing'));
app.use('/api/admin/compliance', require('./routes/admin/compliance'));
app.use('/api/admin/recon', require('./routes/admin/recon'));
app.use('/api/admin/bookings', require('./routes/admin/bookings'));
app.use('/api/admin/memberships', require('./routes/admin/memberships'));
app.use('/api/admin/mockups', require('./routes/admin/mockups'));
app.use('/api/admin/marketing-assets', require('./routes/admin/marketingAssets'));
app.use('/api/admin/theme-registry', require('./routes/admin/themeRegistry'));
app.use('/api/admin/support', require('./routes/admin/support'));
app.use('/api/admin/customer-import', require('./routes/admin/customerImport'));

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
  startBookingReminderSweeper();
  // P12 direct-key payments: reconcile held (pending_payment) bookings against
  // Stripe — finalize paid-but-closed-tab checkouts, release abandoned holds.
  startBookingCheckoutSweeper();
  // Lifecycle/marketing emails (N4): first-visit follow-up, etc. Opt-out honored.
  startLifecycleSweeper();
  // Venue memberships (P14 E2): stamp renewal_due/expired, send renewal reminders,
  // finalize cancel-at-period-end. Transactional — not gated by marketing opt-out.
  startMembershipRenewalSweeper();
  // Lead-gen follow-up sequencer (A2 → read-gated call → A8 → A20). Inert until
  // crm_settings.leadgen_sequencer.enabled = true.
  startOutreachSequencer();
  // Commission (P13): meter the just-closed month → billing_charges kind='commission'.
  // Gated OFF (COMMISSION_SCHEDULER_ENABLED=true to arm); manual /commission/run meanwhile.
  startCommissionScheduler();
  // Anti-under-reporting (2026-08-05): a priced confirmed/completed booking not
  // marked collected within 24h of its scheduled time is auto-marked collected
  // (enters the commission basis). Skips demo sites → inert until a real tenant.
  startBookingAutoCollectSweeper();
  // Domain renewals (2026-08-10): T-30 renewal invoice at renewal retail +
  // T-7 reminders; expiry notices when the tenant turned auto-renew off.
  // Inert until a managed domain is within 35 days of expiry.
  startDomainRenewalSweeper();
  // Nexus alerts (2026-08-10): email staff when Stemfra's real billed sales into
  // a US state hit 80% of its economic-nexus threshold. Gated OFF
  // (NEXUS_ALERTS_ENABLED=true); inert pre-launch (all sales are demo).
  startNexusSweeper();
  startReconSweeper();
});
