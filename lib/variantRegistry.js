// Machine-readable archetype-variant registry (Case 6 R1).
//
// The static half of the theme-component catalog: every archetype the theme
// system dispatches on (the keys of `templates.archetype_variants`) and every
// variant its type union declares, with register + a one-line description.
// The DYNAMIC half — which themes actually use each variant — is computed live
// from the `templates` table by themeRegistryController, so it never drifts.
//
// Sources of truth: the variant type unions in `packages/archetypes/src/*/types.ts`
// (existence) + `stemfra_platform/docs/THEME_VARIANTS.md` (descriptions/register).
// KEEP IN SYNC: adding a variant to a union = add an entry here + a row in the
// doc, same PR. Registers: 'light' (light page/dark text), 'dark', 'any'
// (token-driven, works on both).
//
// R2 (the Remix engine) will consume this as its component menu; R3 (the
// owner-facing "swap the look" picker) will need it client-side — move/mirror
// to @stemfra/site-data at that point.

const VARIANT_REGISTRY = [
  {
    key: 'header',
    component: 'Header',
    label: 'Header / navbar',
    variants: [
      { key: 'default', register: 'any', description: '2-zone bar: brand left, nav + CTA right.' },
      { key: 'centered-wordmark', register: 'any', description: '3-zone: nav left, centered wordmark, nav right + CTA.' },
      { key: 'scroll-flip', register: 'any', description: 'Transparent over the hero, flips solid past a scroll threshold.' },
      { key: 'wordmark-pills', register: 'light', description: 'Opaque bar, serif wordmark + tag, dual pill CTAs, optional mega-menu.' },
      { key: 'solid', register: 'any', description: 'Always-solid opaque bar, 3-column grid, serif nav.' },
      { key: 'volt', register: 'dark', description: 'Dark sticky bar, accent wordmark + dot, uppercase nav.' },
      { key: 'blackfly', register: 'dark', description: 'Accent phone link right, transparent over hero.' },
      { key: 'crossfit212', register: 'dark', description: 'Links left, social right, transparent over hero.' },
      { key: 'floating-pill', register: 'any', description: 'Detached floating pill nav container.' },
      { key: 'ruled-bar', register: 'light', description: 'Paper bar + bottom hairline, seal + wordmark, caps links with scrollspy.' },
      { key: 'glass-overlay', register: 'light', description: 'Transparent blurred nav over the hero → solid bar on scroll.' },
    ],
  },
  {
    key: 'footer',
    component: 'Footer',
    label: 'Footer',
    variants: [
      { key: 'default', register: 'any', description: '2-zone: brand + tagline left, links right.' },
      { key: 'newsletter-multi-col', register: 'any', description: 'Newsletter signup block + link-group columns + social.' },
      { key: 'textured-columns', register: 'any', description: 'Deep bg + multiply photo texture, circular initials badge.' },
      { key: 'dark-centered', register: 'dark', description: 'Near-black, centered brand + single link row + social.' },
      { key: 'visit-deep', register: 'any', description: 'Deep band, giant "Visit" wordmark, address/menu/contact columns + newsletter.' },
      { key: 'dark-columns', register: 'dark', description: 'Near-black, wordmark + nav menu + social + fine print.' },
      { key: 'blackfly', register: 'dark', description: 'Signature phone link + compact multi-column.' },
      { key: 'wordmark-giant', register: 'any', description: 'Large centered wordmark + inset portrait + italic mark.' },
      { key: 'light-columns', register: 'light', description: 'Light bg, link-group columns, social icons.' },
      { key: 'dark-editorial', register: 'dark', description: 'Espresso band, seal + wordmark, swash-italic tagline, newsletter + columns.' },
      { key: 'accent-panel', register: 'light', description: 'Accent band, wordmark, link row + translucent inset CTA panel.' },
    ],
  },
  {
    key: 'hero',
    component: 'Hero',
    label: 'Hero',
    variants: [
      { key: 'default', register: 'any', description: 'Full-bleed photo, serif headline bottom-left, vignette.' },
      { key: 'viewport-video', register: 'any', description: 'Image poster + muted video loop, full-screen.' },
      { key: 'cinematic-right', register: 'any', description: 'Full-screen grayscale photo, right-anchored serif caps.' },
      { key: 'ambient-wordmark', register: 'any', description: 'Cross-fading video stack + giant centered serif wordmark.' },
      { key: 'centered-modest', register: 'any', description: 'Dark photo, centered compact serif headline, sans subline.' },
      { key: 'wordmark-giant', register: 'light', description: 'Brand name set huge on paper, italic tagline, no photo.' },
      { key: 'kinetic', register: 'dark', description: 'Dark photo, giant condensed headline with accent middle line, dual CTAs.' },
      { key: 'ring-burst', register: 'dark', description: 'Social follow strip + accent ring-burst decoration.' },
      { key: 'wordmark-photo', register: 'dark', description: 'Wordmark over photo, minimalist.' },
      { key: 'editorial-layered', register: 'any', description: 'Floating filter chips + badge + inset image card.' },
      { key: 'wordmark-overlay', register: 'any', description: 'Wordmark composited over the photo background.' },
      { key: 'overlay-booking', register: 'dark', description: 'Dark headline band + photo tile strip + floating live booking bar.' },
      { key: 'photo-overlay', register: 'light', description: 'Centered mixed-italic headline, grayscale photo, rotating "explore" disc.' },
    ],
  },
  {
    key: 'story',
    component: 'StoryBlock',
    label: 'Story block',
    variants: [
      { key: 'default', register: 'any', description: 'Image + text split, side alternates.' },
      { key: 'editorial-split', register: 'light', description: 'Paper band, accent eyebrow + divider, split paragraphs.' },
      { key: 'soft-split', register: 'light', description: 'Text left / image right, tracked eyebrow, pill CTA.' },
      { key: 'split-feature', register: 'any', description: 'Full-viewport split, large serif accent headline, arrow CTA.' },
      { key: 'feature-portrait', register: 'light', description: '4:5 portrait + paper panel, serif accent headline, content-sized.' },
      { key: 'blackfly', register: 'dark', description: 'Split with variable image sizing (large/small/full).' },
    ],
  },
  {
    key: 'service_menu',
    component: 'ServiceMenu',
    label: 'Services section',
    variants: [
      { key: 'default', register: 'any', description: 'Per-service grid via ServiceCard.' },
      { key: 'category-cards', register: 'any', description: '3-up owner-authored category cards in a scroll-snap carousel.' },
      { key: 'tile-grid', register: 'any', description: 'Square photo tiles with dark hover blurb (superseded by category-tabs).' },
      { key: 'photo-menu', register: 'light', description: 'Editorial photo left, flat price menu with dotted leaders right.' },
      { key: 'category-tabs', register: 'any', description: 'Category tab bar → per-category photo tiles.' },
      { key: 'accordion', register: 'any', description: 'Priced rows, tap to expand description + duration.' },
      { key: 'blackfly', register: 'dark', description: 'Bespoke multi-category display.' },
      { key: 'feature-cards', register: 'any', description: 'Content-driven category feature cards.' },
      { key: 'reveal-cards', register: 'any', description: 'Cards that reveal content on interaction.' },
      { key: 'detail-rows', register: 'dark', description: 'Alternating photo rows with Benefits / Perfect-For + price chips.' },
      { key: 'detail-cards', register: 'any', description: 'Photo-topped treatment card grid, benefits + duration chip.' },
      { key: 'ruled-rows', register: 'light', description: 'Bordered 2-cell rows: copy | framed grayscale photo + floating READ MORE.' },
      { key: 'quiet-cards', register: 'light', description: 'Soft hairline rounded cards, faint glyph corner, "Learn more" link.' },
    ],
  },
  {
    key: 'service_card',
    component: 'ServiceCard',
    label: 'Service card',
    variants: [
      { key: 'default', register: 'any', description: 'Image thumb + name/price below.' },
      { key: 'hover-overlay', register: 'any', description: '4:5 portrait, hover dims the photo and fades in details.' },
    ],
  },
  {
    key: 'team_grid',
    component: 'TeamGrid',
    label: 'Team section',
    variants: [
      { key: 'default', register: 'any', description: '3-up portrait grid.' },
      { key: 'editorial', register: 'light', description: 'Grayscale portraits that color on hover, serif caps names, accent rule.' },
      { key: 'editorial-carousel', register: 'light', description: 'Editorial cards in a scroll-snap carousel with overflow arrows.' },
      { key: 'soft-tiles', register: 'any', description: 'Square tiles, dark hover-reveal with years + specialties.' },
      { key: 'coach-cards', register: 'dark', description: 'Dark coach cards, accent top border, credential line.' },
      { key: 'blackfly', register: 'dark', description: 'Bespoke team layout.' },
      { key: 'council', register: 'any', description: 'Coach-card layout + transparency + clickable links.' },
      { key: 'soft-carousel', register: 'any', description: 'Soft tiles in a scroll-snap carousel.' },
      { key: 'rating-cards-band', register: 'dark', description: 'Cards on a rounded accent band with on-photo rating pills, carousel.' },
      { key: 'profiles', register: 'any', description: 'Alternating full-bio rows with rating pill + "Book with <name>".' },
      { key: 'bw-portraits', register: 'light', description: 'Grayscale portrait grid, un-grays on hover.' },
    ],
  },
  {
    key: 'testimonials',
    component: 'Testimonials',
    label: 'Reviews / testimonials',
    variants: [
      { key: 'default', register: 'any', description: 'Featured pull-quote + static card grid.' },
      { key: 'editorial-marquee', register: 'any', description: 'Optional stats panel + auto-scroll marquee, pause on hover.' },
      { key: 'rotating-quote', register: 'any', description: 'One quote at a time, accent stars, dot navigation.' },
      { key: 'review-cards', register: 'light', description: 'White review cards with stars + read-more clamp.' },
      { key: 'pr-cards', register: 'dark', description: 'Dark member cards, accent role + stars.' },
      { key: 'blackfly', register: 'dark', description: 'Bespoke testimonial layout.' },
      { key: 'feature-quote', register: 'any', description: 'Large pull-quote with optional image.' },
      { key: 'quote-card', register: 'any', description: 'Single quote + optional author portrait panel.' },
      { key: 'quote-row', register: 'light', description: 'Up to 3 quotes in a ruled row with mark glyph + avatars.' },
      { key: 'centered-band', register: 'light', description: 'One centered serif quote on a soft wash, stars + dots.' },
    ],
  },
  {
    key: 'gallery',
    component: 'Gallery',
    label: 'Gallery',
    variants: [
      { key: 'default', register: 'any', description: 'Editorial tight-gutter grid.' },
      { key: 'instagram-grid', register: 'light', description: 'Instagram-profile card + square post grid.' },
      { key: 'showcase-carousel', register: 'any', description: 'Scroll-snap carousel with per-card booking CTA.' },
      { key: 'two-up', register: 'light', description: 'Heading left / intro right, two large photos per row.' },
      { key: 'masonry', register: 'any', description: 'Grayscale 2×2-featured grid, color on hover.' },
      { key: 'bw-masonry', register: 'light', description: 'Masonry alias with grayscale baked in.' },
      { key: 'blackfly', register: 'dark', description: 'Bespoke gallery.' },
      { key: 'journal-cards', register: 'light', description: 'Wellness-journal blog-style cards with "Read more".' },
      { key: 'featured-strip', register: 'any', description: 'One large featured image + thumbnail strip with prev/next arrows.' },
    ],
  },
  {
    key: 'location',
    component: 'LocationCard',
    label: 'Location / find us',
    variants: [
      { key: 'default', register: 'any', description: 'Light panel, optional map left, details right.' },
      { key: 'dark-panel', register: 'dark', description: 'Dark band + grayscale backdrop, icon rows, accent CTA, map fallback.' },
      { key: 'photo-panel', register: 'light', description: 'Tall photo left, white details card right.' },
      { key: 'brand-split', register: 'any', description: '50/50 on accent: wordmark left, details panel right.' },
      { key: 'visit-deep', register: 'any', description: 'DEAD CODE — superseded by the visit-deep FOOTER; safe to delete.' },
      { key: 'accent-panel', register: 'light', description: 'Accent panel with location details.' },
    ],
  },
  {
    key: 'page_header',
    component: 'PageHeader',
    label: 'Inner-page header',
    variants: [
      { key: 'default', register: 'any', description: 'Solid light title band, eyebrow + optional body.' },
      { key: 'editorial', register: 'light', description: 'Serif caps title, accent eyebrow + divider bar.' },
      { key: 'soft', register: 'any', description: 'Centered, accent eyebrow, no divider.' },
      { key: 'hero-photo', register: 'any', description: 'Full-bleed dark photo + centered title (optional full-screen).' },
      { key: 'dark', register: 'dark', description: 'Near-black band, light title.' },
    ],
  },
  {
    key: 'stats_band',
    component: 'StatsBand',
    label: 'Stats band',
    variants: [
      { key: 'default', register: 'dark', description: 'Dark contrast band, accent serif numbers.' },
      { key: 'light-cards', register: 'light', description: 'White bordered stat cards, dark serif numbers.' },
      { key: 'ruled-counters', register: 'light', description: 'Big serif numbers in a full ruled box grid.' },
    ],
  },
  {
    key: 'marquee',
    component: 'Marquee',
    label: 'Marquee band',
    variants: [
      { key: 'band', register: 'any', description: 'Scrolling accent slogan band (the default).' },
      { key: 'quiet', register: 'any', description: 'Subtler, smaller marquee.' },
    ],
  },
  {
    key: 'faq',
    component: 'FAQ',
    label: 'FAQ',
    variants: [
      { key: 'default', register: 'any', description: 'Standard expandable list.' },
      { key: 'cards', register: 'any', description: 'Card-styled FAQ items.' },
    ],
  },
];

module.exports = { VARIANT_REGISTRY };
