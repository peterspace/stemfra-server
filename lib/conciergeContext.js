// Knowledge context for the Concierge (Agent 1) — the chat on Stemfra's OWN
// marketing site — and for Stemfra Voice ("Mark", Agent 3) via
// buildVoiceKnowledge(). The Concierge answers from Stemfra's product knowledge:
// the offer, what's included, verticals, how onboarding works, and where to send
// the visitor next.
//
// ⚠ PRICING = the COMMISSION MODEL. Source of truth: stemfra_server/docs/
// COMMISSION_MODEL.md + the /fees policy (stemfra_client Fees.jsx). Free website,
// no setup fee, no monthly fee, no tiers — everyone gets every feature, and
// Stemfra earns a flat 5% commission on the sales made through the site. NEVER
// quote the RETIRED subscription tiers ($99/$199/$399) or a $1,000 setup fee.

function buildConciergeContext() {
  return {
    company: {
      name: 'Stemfra',
      what: 'Stemfra builds and runs a turnkey, professionally-designed website with built-in booking, card payments and an AI front desk for local service businesses in the US. Done-for-you: we design it, set it up, and import your data, and you run it from one simple dashboard (or ask Stacy, the AI assistant, to do it for you).',
      verticals: ['Barbershops', 'Beauty salons', 'CrossFit / fitness boxes', 'Yoga & pilates studios', 'Massage & bodywork', 'Spas'],
      differentiators: [
        'Free, done-for-you website: no setup fee, no monthly fee, and no contract.',
        'Stemfra earns a flat 5% commission on the sales you make through your site. We only earn when you do.',
        'Everyone gets every feature. There are no tiers and no feature gating.',
        'Booking is built into the site, so clients book, reschedule and pay without leaving the page.',
        "Card payments go through the business's OWN Stripe, straight to their bank. Stemfra never holds funds.",
        'Works alongside your current system (Mindbody/Wodify/etc.): we import your data and you switch at your pace.',
        'A free custom domain is included.',
      ],
    },

    pricing: {
      model: 'commission',
      headline: 'Free website: no setup fee, no monthly fee, no contract. Stemfra earns a flat 5% commission on the sales you make through your Stemfra site.',
      how_the_5_percent_works: [
        'The 5% applies to all sales made through your site: online bookings paid on the site, in-person or at-visit sales you mark as collected, memberships, class packs, drop-ins, and product orders.',
        'Tips and taxes are never counted. If you refund a customer, the 5% on that sale reverses.',
        'The commission is billed once a month by invoice, which you pay by bank transfer. It is never taken out of the card charge.',
        "When you take card payments, the money goes straight to your own Stripe account and bank. The payment processor's own fee (roughly 2.8% + $0.30) is separate and is never blended into our 5%.",
      ],
      included_free: [
        'A hand-designed, mobile-first website built for your industry, with a free custom domain',
        '24/7 online booking built into the site',
        'Card payments at booking, paid to your own bank via Stripe',
        'Memberships, class packs & drop-ins',
        'Member accounts, so clients book, reschedule & manage their plan',
        'An AI Front Desk that answers from your live prices, hours & services, captures leads, and books appointments',
        'Leads inbox, bookings calendar & client list',
        'Automated email appointment reminders',
        'Unlimited team members and multi-site management',
        'Owner dashboard plus Stacy, your AI setup assistant',
        'Done-for-you setup, ongoing site updates, and support',
      ],
    },

    how_it_works: [
      'Get started free. You preview your real site before anything goes live, and there is nothing to pay to start.',
      'We set it up for you and import your existing client data.',
      'Stacy (the AI assistant) helps you fill in your services, prices, team and hours.',
      'Publish to go live on your free custom domain. You can keep your current system and switch at your pace.',
      'From then on, Stemfra earns a flat 5% on the sales you make through the site, billed monthly by invoice.',
    ],

    // Where to send the visitor next. The agent can surface these as CTA buttons.
    links: {
      start_free: '/start',     // self-serve: free onboarding into the CMS
      pricing: '/pricing',
      examples: '/design',      // the templates gallery
      contact: '/contact',      // human follow-up / questions
    },

    // The agent should route by intent (per Peter): self-serve-ready visitors →
    // "Get started free"; high-touch signals (done-for-you setup, multiple
    // locations, switching from another provider, custom work) → offer a human.
    guidance: 'Default to guiding visitors to get started free and onboard themselves. Only capture a lead for a human when they ask to talk to someone, want hands-on help, or have a complex/high-touch need (multi-location, migrating from another platform, custom work). Never quote a monthly plan price or a setup fee. The model is a free website plus a flat 5% commission on sales.',
  };
}

// Compact, SPOKEN-language version of the knowledge for Stemfra Voice. The chat
// Concierge can afford the full JSON context; on a live phone call that JSON is
// tokens the model must read before EVERY reply — measurable added latency. Same
// facts as buildConciergeContext(), distilled to a tight brief.
// ⚠ KEEP IN SYNC with buildConciergeContext() above (commission model).
function buildVoiceKnowledge() {
  return [
    'STEMFRA — what to know (speak it naturally in your own words, never read this list aloud):',
    '- Stemfra builds and runs a done-for-you website with built-in booking, card payments and an AI front desk for local service businesses: barbershops, salons, CrossFit and fitness, yoga and pilates, massage and spas. We design it, set it up and import your data; you run it from one simple dashboard, or ask Stacy, our AI assistant, to do it for you.',
    '- The website is free: no setup fee, no monthly fee, and no contract. Instead, Stemfra earns a flat five percent commission on the sales you make through your site, so we only earn when you do. Everyone gets every feature; there are no tiers.',
    '- The five percent applies to all sales through the site: online bookings and in-person sales you mark as collected, memberships, packs and drop-ins. Tips and taxes are never counted, and refunds reverse the commission. We bill it once a month by invoice that you pay by bank transfer; it is never taken out of the card charge. Card payments go through your own Stripe straight to your bank, so Stemfra never holds your money, and the processor fee is separate.',
    '- Getting started: you can start free and preview your real site before anything goes live; we set it up and import your existing client data; Stacy helps you fill in your services, prices, team and hours; then you publish to go live on your free domain. You can keep your current system, like Mindbody or Wodify, and switch at your own pace.',
    '- To move forward: point them to get started free at stemfra dot com, or offer to take their details so a teammate follows up.',
  ].join('\n');
}

module.exports = { buildConciergeContext, buildVoiceKnowledge };
