// Seed the Solutions-page imagery slots (CRM "Solutions imagery" tab) from the
// URLs currently hardcoded in stemfra_client's data/solutions.js. For each of
// the 36 slots (6 verticals × hero + 5 problems) Cloudinary ingests the remote
// image into the slot's FIXED public_id under stemfra_assets/marketing/ and the
// marketing_assets row is upserted (group_key 'solutions') — so the current
// look becomes the CRM-managed default and nothing visually changes.
// Idempotent: re-running re-uploads to the same public_ids and re-upserts.
//
// Run from the server dir:
//   node scripts/seed-solutions-imagery.js
require('dotenv').config();
const supabase = require('../config/supabase');
const { cloudinary, isCloudinaryConfigured } = require('../config/cloudinary');

const MARKETING_FOLDER = 'stemfra_assets/marketing';
const publicIdFor = (slot) => `${MARKETING_FOLDER}/${slot.replace(/\./g, '-')}`;

// Mirror of stemfra_client src/app/data/solutions.js (2026-07-15) — hero.image
// + problems[i].image/label per live vertical. If solutions.js gains images,
// add them here and re-run (or just upload via the CRM tab directly).
const VERTICALS = {
  barbers: {
    name: 'Barbershops',
    hero: 'https://images.unsplash.com/photo-1781455793310-8427c96454c7?w=1980&q=85',
    problems: [
      { label: 'Online booking', url: 'https://images.unsplash.com/photo-1503951914875-452162b0f3f1?w=1600&q=85' },
      { label: 'Automated reminders', url: 'https://images.unsplash.com/photo-1521223890158-f9f7c3d5d504?w=1600&q=85' },
      { label: 'Per-barber calendars', url: 'https://res.cloudinary.com/dvdbec2fe/image/upload/v1781016106/argyle-and-sons/c6e48fda6fb049929eb754c69c05c8ee.webp' },
      { label: 'Card payments', url: 'https://images.unsplash.com/photo-1596728325488-58c87691e9af?w=1600&q=85' },
      { label: 'Be found on Google', url: 'https://images.unsplash.com/photo-1599351431202-1e0f0137899a?w=1600&q=85' },
    ],
  },
  salons: {
    name: 'Beauty Salons',
    hero: 'https://images.unsplash.com/photo-1626383137804-ff908d2753a2?w=1980&q=85',
    problems: [
      { label: 'Online booking', url: 'https://images.unsplash.com/photo-1580618672591-eb180b1a973f?w=1600&q=85' },
      { label: 'Automated reminders', url: 'https://images.unsplash.com/photo-1556741533-6e6a62bd8b49?w=1600&q=85' },
      { label: 'Per-stylist calendars', url: 'https://images.unsplash.com/photo-1581404788767-726320400cea?w=1600&q=85' },
      { label: 'Card payments', url: 'https://images.unsplash.com/photo-1683313107043-283d0319a11e?w=1600&q=85' },
      { label: 'Be found on Google', url: 'https://images.unsplash.com/photo-1535637603896-07c179d71103?w=1600&q=85' },
    ],
  },
  crossfit: {
    name: 'CrossFit',
    hero: 'https://images.unsplash.com/photo-1534258936925-c58bed479fcb?w=1980&q=85',
    problems: [
      { label: 'Online booking', url: 'https://images.unsplash.com/photo-1608138279038-8dd61d909bd0?w=1600&q=85' },
      { label: 'Automated reminders', url: 'https://images.unsplash.com/photo-1651840403916-d1e0515b32c4?w=1600&q=85' },
      { label: 'Per-coach schedules', url: 'https://images.unsplash.com/photo-1547226238-e53e98a8e59d?w=1600&q=85' },
      { label: 'Card payments', url: 'https://images.unsplash.com/photo-1780510418967-e0e3ae2109e2?w=1600&q=85' },
      { label: 'Be found on Google', url: 'https://images.unsplash.com/photo-1612000655798-7c202a54084d?w=1600&q=85' },
    ],
  },
  yoga: {
    name: 'Yoga',
    hero: 'https://images.unsplash.com/photo-1761971975724-31001b4de0bf?w=1980&q=85',
    problems: [
      { label: 'Online booking', url: 'https://images.unsplash.com/photo-1692182549439-2a78c119dc40?w=1600&q=85' },
      { label: 'Automated reminders', url: 'https://images.unsplash.com/photo-1687783615494-b4a1f1af8b58?w=1600&q=85' },
      { label: 'Teacher schedules', url: 'https://images.unsplash.com/photo-1651077837628-52b3247550ae?w=1600&q=85' },
      { label: 'Card payments', url: 'https://images.unsplash.com/photo-1742239614185-b50da3deb7cd?w=1600&q=85' },
      { label: 'Be found on Google', url: 'https://images.unsplash.com/photo-1620643089599-d0d1246217b5?w=1600&q=85' },
    ],
  },
  massage: {
    name: 'Massage Studios',
    hero: 'https://images.unsplash.com/photo-1630835425197-50feeba99ecd?w=1980&q=85',
    problems: [
      { label: 'Online booking', url: 'https://images.unsplash.com/photo-1600783245563-16114264a2c8?w=1600&q=85' },
      { label: 'Automated reminders', url: 'https://images.unsplash.com/photo-1656570787612-db91a85693d3?w=1600&q=85' },
      { label: 'Per-therapist calendars', url: 'https://images.unsplash.com/photo-1559185590-d545a0c5a1dc?w=1600&q=85' },
      { label: 'Card payments', url: 'https://images.unsplash.com/photo-1556740720-776b84291f8e?w=1600&q=85' },
      { label: 'Be found on Google', url: 'https://images.unsplash.com/photo-1780407022474-6168b8d21790?w=1600&q=85' },
    ],
  },
  spa: {
    name: 'Day Spas',
    hero: 'https://images.unsplash.com/photo-1776763019060-fa0663574ae6?w=1980&q=85',
    problems: [
      { label: 'Online booking', url: 'https://images.unsplash.com/photo-1630595271375-5073a6c0638b?w=1600&q=85' },
      { label: 'Automated reminders', url: 'https://images.unsplash.com/photo-1630835474626-b4de96a25186?w=1600&q=85' },
      { label: 'Per-therapist calendars', url: 'https://images.unsplash.com/photo-1731514771613-991a02407132?w=1600&q=85' },
      { label: 'Card payments', url: 'https://images.unsplash.com/photo-1746723370709-70d89a7b7999?w=1600&q=85' },
      { label: 'Be found on Google', url: 'https://images.unsplash.com/photo-1763873993447-1d0be71a96d9?w=1600&q=85' },
    ],
  },
};

async function seedSlot({ slot, url, label, alt }) {
  const result = await cloudinary.uploader.upload(url, {
    public_id: publicIdFor(slot),
    resource_type: 'image',
    overwrite: true,
    invalidate: true,
  });
  const row = {
    slot,
    url: result.secure_url,
    storage_key: result.public_id,
    width: result.width,
    height: result.height,
    bytes: result.bytes,
    mime_type: `image/${result.format}`,
    label,
    alt_text: alt,
    group_key: 'solutions',
  };
  const { error } = await supabase.from('marketing_assets').upsert(row, { onConflict: 'slot' });
  if (error) throw error;
  return result;
}

(async () => {
  if (!isCloudinaryConfigured()) {
    console.error('Cloudinary is not configured — check .env');
    process.exit(1);
  }
  let ok = 0;
  let failed = 0;
  for (const [slug, v] of Object.entries(VERTICALS)) {
    const jobs = [
      { slot: `solutions.${slug}.hero.photo`, url: v.hero, label: `${v.name} · Hero`, alt: `Inside a real ${v.name.toLowerCase().replace(/s$/, '')} — Stemfra solutions hero` },
      ...v.problems.map((p, i) => ({
        slot: `solutions.${slug}.problem_${i + 1}.photo`,
        url: p.url,
        label: `${v.name} · Problem ${i + 1} — ${p.label}`,
        alt: p.label,
      })),
    ];
    for (const job of jobs) {
      try {
        const r = await seedSlot(job);
        ok++;
        console.log(`✓ ${job.slot} (${r.width}×${r.height})`);
      } catch (err) {
        failed++;
        console.error(`✗ ${job.slot}: ${err.message}`);
      }
    }
  }
  console.log(`\nDone: ${ok} seeded, ${failed} failed.`);
  process.exit(failed ? 1 : 0);
})();
