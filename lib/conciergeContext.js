// Knowledge context for the Concierge (Agent 1) — the chat on Stemfra's OWN
// marketing site. Unlike Front Desk/Stacy (which read a tenant's live site data),
// the Concierge answers from Stemfra's product knowledge: pricing, plans, verticals,
// how onboarding works, and where to send the visitor next.
//
// ⚠ KEEP IN SYNC with stemfra_client/src/app/data/verticals.js (the marketing site's
// source of truth for SETUP_FEE + TIERS + VERTICALS). If pricing changes there,
// change it here too — the Concierge must never quote a stale price.

function buildConciergeContext() {
  return {
    company: {
      name: 'Stemfra',
      what: 'Stemfra builds turnkey, professionally-designed websites with built-in booking and card payments for local service businesses in the US. Done-for-you: we design it, set it up, and import your data — you run it from one simple dashboard (or ask Stacy, the AI assistant, to do it for you).',
      verticals: ['Barbershops', 'Beauty salons', 'CrossFit / fitness boxes', 'Yoga & pilates studios'],
      differentiators: [
        'Done-for-you setup + ongoing site updates (not a DIY builder).',
        'Booking is built into the site — clients book, reschedule and pay without leaving the page.',
        "Payments go through the business's OWN Stripe, straight to their bank — Stemfra never holds funds.",
        'Works alongside your current system (Mindbody/Wodify/etc.) — we import your data and you switch at your pace.',
        'A free custom domain is included.',
        'Cancel anytime.',
      ],
    },

    pricing: {
      setup_fee_usd: 1000,
      setup_note: 'One-time $1,000 setup, done for you (a free custom domain is included).',
      billing: 'Plans are monthly; paying annually gives 2 months free.',
      plans: [
        {
          name: 'Essential', price_usd_month: 99,
          promise: 'Look professional and run your bookings online.',
          includes: [
            'Professionally designed, mobile-first website built for your industry',
            'Free custom domain (or transfer your own)',
            '24/7 online booking built into the site',
            'Card payments at booking, paid to your own bank',
            'Memberships, class packs & drop-ins (recurring billing)',
            'Member accounts (clients book, reschedule & manage their plan)',
            'Owner dashboard (edit site, services, prices, team & hours)',
            'Leads inbox + bookings calendar + client list',
            'Automated email appointment reminders',
            'Client intake forms & waivers at booking',
            'Done-for-you setup + ongoing updates',
            'Stacy — your AI dashboard assistant',
            'Email & chat support',
          ],
        },
        {
          name: 'Growth', price_usd_month: 199, badge: 'Most popular',
          promise: 'Capture every lead, day or night.',
          adds: [
            'Front Desk — a 24/7 AI chat receptionist that answers from your live prices, hours & services, captures leads, and books while you sleep',
            'Promo codes & discounts (first-month offers, loyalty pricing)',
            'Owner analytics (revenue, bookings, top services, new vs returning)',
            'Class waitlists & capacity for group sessions',
            'Priority placement of new themes & features',
          ],
        },
        {
          name: 'Pro', price_usd_month: 399,
          promise: 'Never lose a booking to a missed call.',
          adds: [
            'AI Voice Receptionist — missed calls forward to an AI that answers as your business, books the appointment, and texts a confirmation',
            'SMS appointment reminders',
            'Custom business email (you@yourbusiness.com)',
            'Priority + phone support',
          ],
        },
      ],
    },

    how_it_works: [
      'Pick a plan and start free — you preview your real site before paying anything.',
      'We set it up for you and import your existing client data.',
      'Stacy (the AI assistant) helps you fill in your services, prices, team and hours.',
      'Publish to go live on your free custom domain. You can keep your current system and switch at your pace.',
    ],

    // Where to send the visitor next. The agent can surface these as CTA buttons.
    links: {
      start_free: '/start',     // self-serve: choose a plan → free onboarding into the CMS
      pricing: '/pricing',
      examples: '/design',      // the templates gallery
      contact: '/contact',      // human follow-up / questions
    },

    // The agent should route by intent (per Peter): self-serve-ready visitors → "Start
    // free"; high-touch signals (done-for-you setup, multiple locations, switching from
    // another provider, enterprise) → offer to take their details for a human follow-up.
    guidance: 'Default to guiding visitors to start free and onboard themselves. Only capture a lead for a human when they ask to talk to someone, want hands-on help, or have a complex/high-touch need (multi-location, migrating from another platform, custom work).',
  };
}

// Compact, SPOKEN-language version of the knowledge for Stemfra Voice. The chat
// Concierge can afford the full JSON context; on a live phone call that JSON is
// ~700 tokens the model must read before EVERY reply — measurable added latency.
// This is the same facts as buildConciergeContext(), distilled to a tight brief.
// ⚠ KEEP IN SYNC with buildConciergeContext() above (and verticals.js).
function buildVoiceKnowledge() {
  return [
    'STEMFRA — what to know (speak it naturally in your own words, never read this list aloud):',
    '- Stemfra builds done-for-you websites with built-in booking and card payments for local service businesses — barbershops, salons, CrossFit and fitness, yoga and pilates. We design it, set it up and import your data; you run it from one simple dashboard, or ask Stacy, our AI assistant, to do it for you.',
    '- The one-time setup is $1,000, done for you, and it includes a free custom domain. Plans are monthly; pay yearly and you get two months free. Cancel anytime. Payments go through your own Stripe straight to your bank — Stemfra never holds your money.',
    '- Plans: Essential is $99 a month — a professional site with 24/7 online booking and card payments. Growth is $199 a month and is the most popular — it adds Front Desk, a 24/7 AI chat receptionist that answers from your live prices and hours and books while you sleep. Pro is $399 a month — it adds an AI voice receptionist that answers missed calls, books the appointment and texts a confirmation, plus text-message reminders.',
    '- Getting started: pick a plan and start free to preview your real site before paying anything; we set it up and import your existing client data; Stacy helps you fill in your services, prices, team and hours; then you publish to go live on your free domain. You can keep your current system, like Mindbody or Wodify, and switch at your own pace.',
    '- To move forward: point them to start free at stemfra dot com, or offer to take their details so a teammate follows up.',
  ].join('\n');
}

module.exports = { buildConciergeContext, buildVoiceKnowledge };
