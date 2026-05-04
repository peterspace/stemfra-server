/**
 * seed.js — populates the Supabase `articles` table from the seed data below.
 * Run with: npm run seed   (from inside stemfra_server)
 * Safe to re-run — uses upsert on slug so it won't duplicate.
 *
 * Requires SUPABASE_URL and SUPABASE_SECRET_KEY in stemfra_server/.env
 */

require('dotenv').config();
const supabase = require('../config/supabase');

const articles = [
  {
    slug:      'venture-studio-model',
    title:     'The Venture Studio Model',
    excerpt:   'Exploring how venture studios are transforming the startup landscape by combining talent, capital, and infrastructure to build multiple companies simultaneously.',
    read_time: '5 min read',
    category:  'Venture Building',
    image:     'https://images.unsplash.com/photo-1758873272445-433c7a832584?w=1080&q=80',
    published: true,
    content: [
      { type: 'paragraph', text: 'The venture studio model represents a paradigm shift in how technology companies are built.' },
      { type: 'heading',   text: 'What Makes Venture Studios Different' },
      { type: 'paragraph', text: 'Venture studios combine experienced entrepreneurial talent, operational expertise, capital, and shared infrastructure.' },
      { type: 'heading',   text: 'Key Advantages' },
      { type: 'list', items: ['Reduced time to market through shared resources', 'Lower failure rates due to rigorous validation', 'Access to experienced operators', 'Ability to iterate quickly'] },
      { type: 'heading',   text: 'The Future of Venture Building' },
      { type: 'paragraph', text: 'As the venture studio model matures, we\'re seeing specialization emerge — studios focusing on specific sectors.' },
    ],
  },
  {
    slug:      'building-fintech-infrastructure',
    title:    'Building Fintech Infrastructure',
    excerpt:   'The essential components and considerations for creating robust financial technology platforms that scale globally and meet regulatory requirements.',
    read_time: '7 min read',
    category:  'Fintech',
    image:     'https://images.unsplash.com/photo-1761850167081-473019536383?w=1080&q=80',
    published: true,
    content: [
      { type: 'paragraph', text: 'Building financial technology infrastructure requires technical excellence, regulatory compliance, and user-centric design.' },
      { type: 'heading',   text: 'Foundational Requirements' },
      { type: 'list', items: ['Bank-grade security and encryption', 'Comprehensive compliance frameworks (KYC, AML, PCI-DSS)', 'Real-time transaction processing', 'Scalable database architecture', 'Disaster recovery planning'] },
      { type: 'heading',   text: 'Regulatory Compliance' },
      { type: 'quote',     text: "In fintech, compliance isn't a constraint — it's a competitive advantage." },
      { type: 'heading',   text: 'Scaling Challenges' },
      { type: 'paragraph', text: 'The key to successful scaling is building modular, microservices-based architectures that can grow incrementally.' },
    ],
  },
  {
    slug:      'designing-scalable-saas-platforms',
    title:     'Designing Scalable SaaS Platforms',
    excerpt:   'Key architectural decisions and design patterns for building software-as-a-service products that can grow from hundreds to millions of users.',
    read_time: '6 min read',
    category:  'Engineering',
    image:     'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=1080&q=80',
    published: true,
    content: [
      { type: 'paragraph', text: 'Designing a SaaS platform that scales requires making the right architectural decisions from day one.' },
      { type: 'heading',   text: 'Multi-tenancy Architecture' },
      { type: 'paragraph', text: 'Choose between shared database, separate schemas, or separate databases based on your isolation requirements.' },
      { type: 'heading',   text: 'Performance at Scale' },
      { type: 'list', items: ['Database indexing and query optimisation', 'Caching layers (Redis, CDN)', 'Async job queues for heavy operations', 'Horizontal scaling strategies'] },
    ],
  },
  {
    slug:      'launching-technology-startups',
    title:     'Launching Technology Startups',
    excerpt:   'Practical frameworks and lessons learned from helping dozens of technology companies go from idea to market-ready product.',
    read_time: '8 min read',
    category:  'Startups',
    image:     'https://images.unsplash.com/photo-1559136555-9303baea8ebd?w=1080&q=80',
    published: true,
    content: [
      { type: 'paragraph', text: 'Launching a technology startup is one of the most challenging and rewarding endeavours in business.' },
      { type: 'heading',   text: 'Validating Before Building' },
      { type: 'paragraph', text: 'The biggest mistake founders make is building a product before validating demand. Start with the problem, not the solution.' },
      { type: 'heading',   text: 'The MVP Mindset' },
      { type: 'quote',     text: "Done is better than perfect. Ship something real, learn from users, and iterate fast." },
      { type: 'heading',   text: 'Finding Product-Market Fit' },
      { type: 'paragraph', text: 'PMF is when a significant portion of your users would be very disappointed if your product disappeared. Measure this constantly.' },
    ],
  },
];

async function seed() {
  try {
    const { data, error } = await supabase
      .from('articles')
      .upsert(articles, { onConflict: 'slug' })
      .select('slug');

    if (error) throw error;

    console.log(`✓ Seed complete — ${data.length} article(s) upserted`);
    data.forEach((row) => console.log(`  • ${row.slug}`));
    process.exit(0);
  } catch (err) {
    console.error('✗ Seed failed:', err.message);
    process.exit(1);
  }
}

seed();
