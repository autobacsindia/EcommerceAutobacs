/**
 * Home (redesign) content + asset registry — SINGLE SOURCE OF TRUTH.
 *
 * Every image URL and piece of copy on the redesigned home page lives here so
 * the design can be re-skinned without touching component code. Swap any
 * `image` value for your own asset:
 *   - a file you drop in `public/` → "/images/home/hero-car.png"
 *   - a Cloudinary / CDN URL       → "https://res.cloudinary.com/.../car.png"
 *
 * The current values are temporary Unsplash placeholders so the page renders
 * complete out of the box. Replace them as real artwork arrives.
 *
 * NOTE: a missing local asset just shows the `FALLBACK` swatch (see
 * <Img> in ./Img.tsx) instead of a broken-image icon, so it is safe to point
 * at `/images/home/...` paths before the files exist.
 */

/** Neutral placeholder shown when an `image` is empty/missing. */
export const FALLBACK_IMAGE = '';

export interface CategoryItem {
  tag: string;
  name: string; // may contain a single \n for the two-line layout
  href: string;
  image: string;
  featured?: boolean; // editorially promoted hub — leads the carousel, distinct badge
}

export interface ProductItem {
  category: string;
  brand: string;
  name: string;
  price: string;
  href: string;
  image: string;
}

export interface TestimonialItem {
  quote: string;
  name: string;
  detail: string;
  avatar: string;
}

export interface JournalItem {
  category: string;
  date: string;
  readTime?: string;
  title: string;
  excerpt: string;
  href: string;
  image: string;
}

export interface StatItem {
  value: string;
  suffix: string;
  label: string;
}

export const brand = {
  name: 'AUTO',
  nameAccent: 'BAACS',
  /**
   * Logo image. Drop your file in `Front-end/web/public/` and point here, e.g.
   *   logo: '/logo.svg'   (file at Front-end/web/public/logo.svg)
   * or use a CDN/Cloudinary URL. Leave it empty ('') to keep the text wordmark
   * (AUTO + BAACS) below. Used in both the nav and the footer.
   */
  // `e_trim` strips the transparent padding baked into the source PNG (the
  // Roavion stacked lockup is ~775×309 inside a 1160×660 canvas), so the logo
  // fills its height in the navbar instead of floating tiny and off-centre.
  // f_auto,q_auto = optimised delivery. Display size is controlled in CSS via
  // `.logo-img` (see home-redesign.css), NOT by inflating the asset height.
  logo: 'https://res.cloudinary.com/dhwxtl6l8/image/upload/e_trim,f_auto,q_auto/v1782814887/roavion-primary_pwywsn.png',
  logoAlt: 'Autobacs India',
  // Profile avatar in the nav (replace with the signed-in user's image later).
  avatar:
    'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=120&q=80&auto=format&fit=crop',
};

// Nav destinations. `href` is a real, resolvable route (verified against the
// live category taxonomy — `exterior`/`interior` are actual top-level hubs at
// `/categories/<slug>`). "Vehicle Makes" is special-cased in RedesignNav to
// render the RedesignVehicleMenu dropdown, so its `href` is only a no-JS
// fallback, not the primary target.
export const navLinks = [
  { label: 'Shop', href: '/products' },
  { label: 'Exterior', href: '/categories/exterior' },
  { label: 'Interior', href: '/categories/interior' },
  { label: 'Vehicle Makes', href: '/vehicles' },
  { label: 'Offers', href: '/offers' },
  { label: 'Press', href: '/media' },
];

export const hero = {
  eyebrow: 'Performance · Collection',
  headlineTop: 'Drive Beyond',
  headlineAccent: 'Limits.',
  tagline: 'Premium aftermarket parts for the discerning enthusiast.',
  bottomTagline: 'Reimagine every drive.',
  ctaLabel: 'Explore Collection',
  // Served from our own Cloudinary (was a raw Unsplash JPEG). Transform is baked
  // into the delivery URL because the hero renders via a plain <img> (not
  // next/image), so the custom loader doesn't apply here: f_auto→WebP/AVIF,
  // q_auto, w_1200 (this fallback is the MOBILE hero — desktop uses the canvas
  // sequence). Swap the underlying asset by re-uploading the same public_id.
  image:
    'https://res.cloudinary.com/dhwxtl6l8/image/upload/f_auto,q_auto,c_limit,w_1200/autobacs/site/hero-performance-vehicle.jpg',
  imageAlt: 'Performance Vehicle',
};

/**
 * Hero scroll-frame sequence (desktop+ only). The hero "car" image is replaced
 * by a <canvas> that scrubs through these frames as the user scrolls past the
 * hero. Mobile and `prefers-reduced-motion` users fall back to `hero.image` and
 * never download a single frame. See HeroSequence.tsx.
 *
 * Frames live in `public/scroll-frames/` (committed). To regenerate from a new
 * source video: extract every frame at 1440px wide to WebP and keep the
 * `frame_0001.webp … frame_NNNN.webp` naming, then update `count` here.
 */
export const heroSequence = {
  dir: '/scroll-frames',
  prefix: 'frame_',
  ext: 'webp',
  count: 145,
  pad: 4, // zero-padding width of the frame number
  naturalWidth: 1440,
  naturalHeight: 808,
};

export const stats: StatItem[] = [
  { value: '10,000', suffix: '+', label: 'Products Delivered' },
  { value: '1,000', suffix: '+', label: 'Premium Parts' },
  { value: '200', suffix: '+', label: 'Compatible Makes' },
  { value: '50', suffix: '+', label: 'Expert Partners' },
];

export const manifesto = {
  eyebrow: 'Our Philosophy',
  titleTop: 'Not just parts.',
  titleAccent: 'A transformation.',
  body: "We source the world's finest aftermarket components for those who demand more from every drive. Every part we carry has been selected for fit, finish, and the feeling it unlocks behind the wheel.",
};

export const categories: CategoryItem[] = [
  {
    tag: 'Category',
    name: 'Performance\nUpgrades',
    href: '/categories',
    image:
      'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?w=800&q=70&auto=format&fit=crop',
  },
  {
    tag: 'Category',
    name: 'Wheels &\nSuspension',
    href: '/categories',
    image:
      'https://images.unsplash.com/photo-1600712242805-5f78671b24da?w=800&q=70&auto=format&fit=crop',
  },
  {
    tag: 'Category',
    name: 'Exterior &\nAero',
    href: '/categories',
    image:
      'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800&q=70&auto=format&fit=crop',
  },
  {
    tag: 'Category',
    name: 'Engine &\nExhaust',
    href: '/categories',
    image:
      'https://images.unsplash.com/photo-1544636331-e26879cd4d9b?w=800&q=70&auto=format&fit=crop',
  },
  {
    tag: 'Category',
    name: 'Lighting &\nElectronics',
    href: '/categories',
    image:
      'https://images.unsplash.com/photo-1449965408869-eaa3f722e40d?w=800&q=70&auto=format&fit=crop',
  },
  {
    tag: 'Category',
    name: 'Interior &\nCockpit',
    href: '/categories',
    image:
      'https://images.unsplash.com/photo-1503736334956-4c8f8e92946d?w=800&q=70&auto=format&fit=crop',
  },
];

export const showreel = {
  eyebrow: 'Shop by Fitment',
  titleTop: 'Point at the',
  titleAccent: 'Build.',
  body: 'Rotate the truck and tap any part — headlights, roof rack, suspension — to jump straight to those upgrades.',
  // Optional video. Only used as a fallback if the interactive car can't load.
  video: '',
  poster: '',
};

export const products: ProductItem[] = [
  {
    category: "Editor's Choice",
    brand: 'Akrapovič',
    name: 'Evolution Line Titanium Exhaust',
    price: '₹1,24,999',
    href: '/products',
    image:
      'https://images.unsplash.com/photo-1606577924006-27d39b132ae2?w=700&q=75&auto=format&fit=crop',
  },
  {
    category: 'Bestseller',
    brand: 'Brembo',
    name: 'GT Big Brake Kit — 6 Piston',
    price: '₹89,500',
    href: '/products',
    image:
      'https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=700&q=75&auto=format&fit=crop',
  },
  {
    category: 'Suspension',
    brand: 'Bilstein',
    name: 'B16 PSS10 Coilover Kit',
    price: '₹62,000',
    href: '/products',
    image:
      'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?w=700&q=75&auto=format&fit=crop',
  },
  {
    category: 'Limited',
    brand: 'Rays / Volk',
    name: 'TE37SL Super Lap — 18"',
    price: '₹2,20,000',
    href: '/products',
    image:
      'https://images.unsplash.com/photo-1600712242805-5f78671b24da?w=700&q=75&auto=format&fit=crop',
  },
  {
    category: 'Forced Induction',
    brand: 'HKS',
    name: 'GT2 Supercharger Pro Kit',
    price: '₹3,45,000',
    href: '/products',
    image:
      'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=700&q=75&auto=format&fit=crop',
  },
  {
    category: 'Intake',
    brand: 'K&N',
    name: '77 Series Cold Air Intake',
    price: '₹18,750',
    href: '/products',
    image:
      'https://images.unsplash.com/photo-1544636331-e26879cd4d9b?w=700&q=75&auto=format&fit=crop',
  },
];

export const brands: string[] = [
  'HKS',
  'Brembo',
  'Bilstein',
  'Akrapovič',
  'Recaro',
  'Sparco',
  'Öhlins',
  'Rays',
  'Enkei',
  'Project Mu',
  'Tein',
  'K&N',
  'Eibach',
  'StopTech',
];

/**
 * Before/After comparison slider. This section is NOT DB-backed — it's a
 * curated pair of images. Use the SAME aspect ratio for both so the wipe lines
 * up.
 *
 * IMPORTANT: like `hero.image`, these render through a plain <img> (see
 * Transformation.tsx / Img.tsx), NOT next/image — so the Cloudinary loader does
 * NOT apply and the delivery transform MUST be baked into the URL. Always keep
 * `f_auto,q_auto,c_limit,w_1920` right after `/upload/`: f_auto→WebP/AVIF,
 * q_auto→perceptual quality (no visible loss), c_limit,w_1920→cap the width
 * WITHOUT ever upscaling (c_limit is downscale-only). A bare `/upload/v123/x.jpg`
 * URL serves the full-resolution JPEG to every visitor — don't paste one.
 *
 * RESOLUTION NOTE: this slider is full-bleed (`.split-reveal` is width:100%, no
 * max-width) so it paints ~1816 CSS px on a 1920 monitor and ~2× that on retina.
 * The current source assets are only 1672px wide, so on large/high-DPR screens
 * they get upscaled and look soft — that is a SOURCE limitation, not a transform
 * one. To look crisp everywhere, re-upload before/after photos at ≥2560px wide
 * (same public_id); w_1920 above then delivers the extra resolution automatically.
 *
 * ↓↓↓ ADD YOUR CLOUDINARY LINKS HERE (keep the transform prefix) ↓↓↓
 */
export const transformation = {
  eyebrow: 'Before & After',
  titleTop: 'The',
  titleAccent: 'Autobaacs',
  titleBottom: 'Effect.',
  before:
    'https://res.cloudinary.com/dhwxtl6l8/image/upload/f_auto,q_auto,c_limit,w_1920/v1782907582/before_bmw_hlwaqs.jpg',
  after:
    'https://res.cloudinary.com/dhwxtl6l8/image/upload/f_auto,q_auto,c_limit,w_1920/v1782907582/after_bmw_svmikn.jpg',
};

export const testimonials: TestimonialItem[] = [
  {
    quote:
      "Autobaacs transformed my track car into something I genuinely can't stop driving. The HKS kit arrived perfectly packaged, and their install partner in Pune was world-class.",
    name: 'Rahul Desai',
    detail: 'Honda Civic Type R · Mumbai',
    avatar:
      'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=80&q=70&auto=format&fit=crop',
  },
  {
    quote:
      "I've been building cars for 15 years and Autobaacs is the only platform I trust for sourcing genuine performance parts. Delivery was faster than I expected — even to Bangalore.",
    name: 'Arjun Krishnan',
    detail: 'Subaru WRX STI · Bengaluru',
    avatar:
      'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=80&q=70&auto=format&fit=crop',
  },
  {
    quote:
      'The Brembo kit I ordered fit perfectly, and their team helped me pick the right option for my car. Premium experience from start to finish — feels like buying from a luxury brand.',
    name: 'Priya Mehta',
    detail: 'BMW M3 · Delhi',
    avatar:
      'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=80&q=70&auto=format&fit=crop',
  },
  {
    quote:
      'Sourced my Akrapovič exhaust through Autobaacs and the difference is night and day. Genuine product, great price, incredibly smooth process. Will return for my next build.',
    name: 'Vikram Shah',
    detail: 'Porsche 911 GTS · Ahmedabad',
    avatar:
      'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=80&q=70&auto=format&fit=crop',
  },
];

export const journal = {
  eyebrow: 'The Garage Journal',
  titleTop: 'Stories from',
  titleAccent: 'under the hood.',
  body: 'Build guides, product deep-dives and the obsessive details behind every transformation. Written by enthusiasts, for enthusiasts.',
};

export const journalPosts: JournalItem[] = [
  {
    category: 'Exhaust',
    date: 'May 12, 2026',
    readTime: '6 min read',
    title: 'Titanium vs. Stainless: Which Exhaust Actually Sounds Better?',
    excerpt:
      "We put two flagship systems on the same car and the dyno — here's what the weight, the decibels and the back-pressure data really told us.",
    href: '/blog',
    image:
      'https://images.unsplash.com/photo-1606577924006-27d39b132ae2?w=900&q=75&auto=format&fit=crop',
  },
  {
    category: 'Suspension',
    date: 'Apr 28, 2026',
    readTime: '8 min read',
    title: 'Choosing the Right Coilovers for Street & Track',
    excerpt:
      'Spring rates, damping, ride height — the trade-offs that decide whether your setup is a weekend weapon or a daily-driver nightmare.',
    href: '/blog',
    image:
      'https://images.unsplash.com/photo-1600712242805-5f78671b24da?w=900&q=75&auto=format&fit=crop',
  },
  {
    category: 'Brakes',
    date: 'Apr 09, 2026',
    readTime: '5 min read',
    title: 'Big Brake Kits Explained: Do You Really Need Six Pistons?',
    excerpt:
      'Rotor sizing, pad compounds and heat management — a no-nonsense guide to braking upgrades that actually match how you drive.',
    href: '/blog',
    image:
      'https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=900&q=75&auto=format&fit=crop',
  },
  {
    category: 'Wheels',
    date: 'Mar 22, 2026',
    readTime: '7 min read',
    title: 'Forged vs. Cast Wheels: Where the Money Actually Goes',
    excerpt:
      "Strength, weight and cost broken down with real numbers — so you know exactly what you're paying for when you go forged.",
    href: '/blog',
    image:
      'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?w=900&q=75&auto=format&fit=crop',
  },
  {
    category: 'Engine',
    date: 'Mar 04, 2026',
    readTime: '9 min read',
    title: 'Intake & Tuning Basics: Unlocking Safe, Reliable Power',
    excerpt:
      'From cold-air intakes to a proper remap — the sensible order of operations for chasing power without compromising longevity.',
    href: '/blog',
    image:
      'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=900&q=75&auto=format&fit=crop',
  },
  {
    category: 'Interior',
    date: 'Feb 18, 2026',
    readTime: '4 min read',
    title: 'Interior Detailing at Home: A Showroom Finish on a Budget',
    excerpt:
      'The tools, products and techniques our detailers swear by — to make a well-used cabin look and feel factory-fresh again.',
    href: '/blog',
    image:
      'https://images.unsplash.com/photo-1503736334956-4c8f8e92946d?w=900&q=75&auto=format&fit=crop',
  },
];

export const footer = {
  blurb:
    "India's premium destination for aftermarket automotive parts and transformation services. Sourced globally, delivered with precision.",
  columns: [
    {
      // Labels + slugs mirror real, active top-level category hubs (see the live
      // taxonomy). Every href resolves to /categories/<slug>; no generic dumps.
      title: 'Shop',
      links: [
        { label: 'Performance', href: '/categories/performance' },
        { label: 'Suspension', href: '/categories/suspension' },
        { label: 'Brakes', href: '/categories/brakes' },
        { label: 'Exterior', href: '/categories/exterior' },
        { label: 'Interior', href: '/categories/interior' },
        { label: 'Lighting', href: '/categories/lighting' },
      ],
    },
    {
      title: 'Company',
      links: [
        { label: 'About Us', href: '/about-us' },
        { label: 'Workshop Network', href: '/consultation' },
        { label: 'Become a Partner', href: '/contact' },
        { label: 'Careers', href: '/careers' },
        { label: 'Press', href: '/media' },
      ],
    },
    {
      title: 'Support',
      links: [
        { label: 'Track Order', href: '/track' },
        { label: 'Returns Policy', href: '/returns' },
        { label: 'Installation Help', href: '/help' },
        { label: 'Fitment Guide', href: '/vehicles' },
        { label: 'Contact Us', href: '/contact' },
      ],
    },
  ],
  copyright: `© ${new Date().getFullYear()} Autobacs India Pvt. Ltd. All rights reserved.`,
  social: [
    { label: 'Facebook', href: 'https://www.facebook.com/autobacsindia' },
    { label: 'Instagram', href: 'https://www.instagram.com/autobacsindia' },
    { label: 'YouTube', href: 'https://www.youtube.com/@AutobacsIndia' },
    { label: 'LinkedIn', href: 'https://www.linkedin.com/company/roavion/' },
  ],
};
