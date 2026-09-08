/**
 * Home (redesign) live-data layer — SERVER ONLY.
 *
 * Fetches the DB-backed sections of the redesigned home page (featured products,
 * category hubs, testimonials, blog posts, brands) and maps each backend
 * document into the view-model shapes the section components already render
 * (see homeContent.ts for the interfaces + static fallbacks).
 *
 * Design rules:
 *   - Server-safe only: imported by the async Server Component `app/page.tsx`,
 *     uses `serverFetch` (no browser globals). Do NOT add 'use client'.
 *   - Resilient: every section is fetched independently (Promise.allSettled);
 *     if a request fails OR returns nothing, that section falls back to the
 *     static placeholders in homeContent.ts so the page never renders broken.
 *   - ISR-cached: requests are tagged so `revalidate` in page.tsx refreshes
 *     them without a redeploy. Flush is automatic on the revalidate window.
 *
 * The Transformation (before/after) section is NOT DB-backed — its images are
 * curated Cloudinary assets edited directly in homeContent.ts (`transformation`).
 */

import { serverFetch } from '@/lib/server-api';
import { formatPriceINR } from '@/utils/priceFormatter';
import { getCarHotspots, type ResolvedCarHotspot } from '@/lib/carHotspots';
import {
  products as fallbackProducts,
  categories as fallbackCategories,
  testimonials as fallbackTestimonials,
  journalPosts as fallbackJournalPosts,
  brands as fallbackBrands,
  type ProductItem,
  type CategoryItem,
  type TestimonialItem,
  type JournalItem,
} from './homeContent';

export interface HomeData {
  products: ProductItem[];
  categories: CategoryItem[];
  testimonials: TestimonialItem[];
  journalPosts: JournalItem[];
  brands: string[];
  carHotspots: ResolvedCarHotspot[];
  /**
   * The live Spin-to-Win campaign, or null when none is running. `null` is the
   * normal, common case — the hero simply renders one slide instead of two.
   */
  spinTeaser: SpinTeaser | null;
}

/**
 * The public teaser the hero's spin slide renders from
 * (backend GET /spin/public/live).
 *
 * Deliberately carries no prize ids, stock or odds — the endpoint redacts them, so
 * there is nothing here that prices the prize economy even though this ships inside
 * the home page's HTML.
 */
export interface SpinTeaser {
  slug: string;
  name: string;
  /** ISO. The hero hides the slide once this passes, ahead of the ISR window. */
  endsAt: string;
  minOrderValuePaise: number;
  /** null = uncapped (every order earns its own spin). */
  maxSpinsPerUserPerCampaign: number | null;
  terms: string | null;
  prizes: SpinTeaserPrize[];
}

export interface SpinTeaserPrize {
  name: string;
  shortLabel: string;
  imageUrl: string | null;
  kind: string;
}

// How many items to pull into each section. Categories are capped at the hub
// count (~12, see the 2-level taxonomy); the rest are sized to the carousels.
const LIMITS = {
  products: 8,
  categories: 12,
  testimonials: 8,
  journal: 6,
  brands: 24,
} as const;

// Revalidate window (seconds) for every home section fetch.
const REVALIDATE = 300;

/* ── backend response shapes (only the fields we read) ───────────────────── */

interface ApiImage {
  url?: string;
  alt?: string;
  isPrimary?: boolean;
}
interface ApiProduct {
  _id: string;
  name: string;
  slug?: string;
  brand?: string;
  price: number;
  images?: ApiImage[];
  categories?: { name?: string; slug?: string }[];
}
interface ApiCategory {
  _id: string;
  name: string;
  slug?: string;
  parent?: { _id: string } | string | null;
  image?: { url?: string; alt?: string };
  isFeatured?: boolean;
}
interface ApiTestimonial {
  id: string;
  name: string;
  title?: string;
  comment?: string;
  product?: { name?: string; image?: string | null } | null;
}
interface ApiArticle {
  title: string;
  slug: string;
  coverImage?: string;
  excerpt?: string;
  category?: string;
  publishedAt?: string;
  createdAt?: string;
}
interface ApiBrand {
  name: string;
}
interface ApiSpinTeaser {
  live?: boolean;
  campaign?: {
    slug?: string;
    name?: string;
    endsAt?: string;
    minOrderValuePaise?: number;
    maxSpinsPerUserPerCampaign?: number | null;
    terms?: string | null;
  };
  prizes?: SpinTeaserPrize[];
}

/* ── mappers (DB doc → redesign view-model) ──────────────────────────────── */

const primaryImage = (images?: ApiImage[]): string => {
  if (!images?.length) return '';
  return (images.find((i) => i.isPrimary) ?? images[0])?.url ?? '';
};

const formatDate = (iso?: string): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
};

const mapProduct = (p: ApiProduct): ProductItem => ({
  category: p.categories?.[0]?.name || 'Featured',
  brand: p.brand || '',
  name: p.name,
  // Formatted here so the initial HTML ships a real price (SEO, no flash), and
  // carried as a number so the card can re-format it for the chosen currency.
  price: typeof p.price === 'number' ? formatPriceINR(p.price) : '',
  priceValue: typeof p.price === 'number' ? p.price : undefined,
  href: `/products/${p.slug || p._id}`,
  image: primaryImage(p.images),
});

const mapCategory = (c: ApiCategory): CategoryItem => ({
  // Badge reflects the real admin-controlled `isFeatured` flag.
  tag: c.isFeatured ? 'Featured' : 'Category',
  name: c.name,
  href: c.slug ? `/categories/${c.slug}` : '/categories',
  image: c.image?.url || '',
  featured: !!c.isFeatured,
});

const mapTestimonial = (t: ApiTestimonial): TestimonialItem => ({
  quote: t.comment || t.title || '',
  name: t.name || 'Verified Buyer',
  detail: t.product?.name || '',
  // No user avatar in the review payload; Img renders its fallback swatch.
  avatar: '',
});

const mapArticle = (a: ApiArticle): JournalItem => ({
  category: a.category || 'Journal',
  date: formatDate(a.publishedAt || a.createdAt),
  readTime: '', // not exposed by the articles list endpoint
  title: a.title,
  excerpt: a.excerpt || '',
  href: `/${a.slug}`, // blog posts are served at the site root (ADR-005)
  image: a.coverImage || '',
});

/* ── section fetchers (each resilient + independently cached) ─────────────── */

async function fetchProducts(): Promise<ProductItem[]> {
  const res = await serverFetch<{ products?: ApiProduct[] }>(
    `/products/featured?limit=${LIMITS.products}`,
    { next: { revalidate: REVALIDATE, tags: ['home:products'] } }
  );
  return (res.products ?? []).map(mapProduct);
}

async function fetchCategories(): Promise<CategoryItem[]> {
  // NOTE: the `v=2` param is a deliberate cache-key reset. Next.js keys the Data
  // Cache by request URL, and an older build cached `/categories?limit=200`
  // BEFORE this fetch carried the `home:categories` tag — leaving a permanent,
  // untaggable entry that `revalidateTag` couldn't purge (it kept serving deleted
  // hubs like "Other" with no featured flags). Bumping the URL forces a fresh,
  // properly-tagged entry that honours `revalidate` + on-demand revalidation.
  const res = await serverFetch<{ categories?: ApiCategory[] }>(
    `/categories?limit=200&v=2`,
    { next: { revalidate: REVALIDATE, tags: ['home:categories'] } }
  );
  // Hubs only = top-level categories (no parent), pre-sorted by `order`
  // server-side. The "Shop by Category" section is a CURATED shelf: it shows
  // ONLY admin-featured hubs (the featured flag exists for exactly this section).
  // If nothing is featured yet, degrade gracefully to the first hubs by `order`
  // so the homepage is never empty — rather than falling through to the static
  // placeholders in withFallback().
  const hubs = (res.categories ?? []).filter((c) => !c.parent);
  const featured = hubs.filter((c) => c.isFeatured);
  const selected = featured.length ? featured : hubs;
  return selected.slice(0, LIMITS.categories).map(mapCategory);
}

async function fetchTestimonials(): Promise<TestimonialItem[]> {
  const res = await serverFetch<{ testimonials?: ApiTestimonial[] }>(
    `/reviews/testimonials?limit=${LIMITS.testimonials}`,
    { next: { revalidate: REVALIDATE, tags: ['home:testimonials'] } }
  );
  return (res.testimonials ?? []).map(mapTestimonial).filter((t) => t.quote);
}

async function fetchJournal(): Promise<JournalItem[]> {
  const res = await serverFetch<{ data?: ApiArticle[] }>(
    `/media/articles?type=blog&limit=${LIMITS.journal}`,
    { next: { revalidate: REVALIDATE, tags: ['home:journal'] } }
  );
  return (res.data ?? []).map(mapArticle);
}

async function fetchBrands(): Promise<string[]> {
  // Parts brands only (make=false), active only — car makes live in the Vehicles
  // section and never appear here. `v=2` is a deliberate cache-key reset: an older
  // build cached `/brands?limit=24` BEFORE the make/active filter was added, so
  // Next's Data Cache could keep serving the stale, unfiltered brand list. Bumping
  // the URL forces a fresh, properly-tagged entry (mirrors the categories fetch).
  const res = await serverFetch<{ brands?: ApiBrand[] }>(
    `/brands?make=false&active=true&limit=${LIMITS.brands}&v=2`,
    { next: { revalidate: REVALIDATE, tags: ['home:brands'] } }
  );
  return (res.brands ?? []).map((b) => b.name).filter(Boolean);
}

/**
 * The live Spin-to-Win campaign, or null.
 *
 * Unlike every other section here there is NO static fallback, and that is the point:
 * this slide advertises a real, running promotion, so inventing one when the backend is
 * silent would promise a wheel the customer cannot spin. A failure, a `live: false`, or
 * a campaign with no prizes left all resolve to `null` and the hero renders its single
 * car slide exactly as it does today.
 */
async function fetchSpinTeaser(): Promise<SpinTeaser | null> {
  const res = await serverFetch<ApiSpinTeaser>(
    '/spin/public/live',
    { next: { revalidate: REVALIDATE, tags: ['home:spin'] } }
  );
  const c = res?.campaign;
  if (!res?.live || !c?.slug || !c?.endsAt) return null;
  // An empty prize list would draw a blank wheel; treat it as "nothing to advertise".
  const prizes = (res.prizes ?? []).filter((p) => p?.name);
  if (!prizes.length) return null;
  return {
    slug: c.slug,
    name: c.name || 'Spin to Win',
    endsAt: c.endsAt,
    minOrderValuePaise: c.minOrderValuePaise ?? 0,
    maxSpinsPerUserPerCampaign: c.maxSpinsPerUserPerCampaign ?? null,
    terms: c.terms ?? null,
    prizes,
  };
}

/**
 * Resolve a section's data, falling back to the static placeholder when the
 * fetch rejects or returns an empty list. Errors are swallowed (logged) so one
 * dead endpoint can never blank the whole home page.
 */
async function withFallback<T>(
  fetcher: () => Promise<T[]>,
  fallback: T[],
  label: string
): Promise<T[]> {
  try {
    const data = await fetcher();
    return data.length ? data : fallback;
  } catch (err) {
    console.error(`[homeData] ${label} fetch failed, using fallback:`, err);
    return fallback;
  }
}

/**
 * Fetch every DB-backed home section in parallel. Always resolves (never
 * throws) — each section independently degrades to its static fallback.
 */
export async function getHomeData(): Promise<HomeData> {
  const [products, categories, testimonials, journalPosts, brands, carHotspots, spinTeaser] =
    await Promise.all([
      withFallback(fetchProducts, fallbackProducts, 'products'),
      withFallback(fetchCategories, fallbackCategories, 'categories'),
      withFallback(fetchTestimonials, fallbackTestimonials, 'testimonials'),
      withFallback(fetchJournal, fallbackJournalPosts, 'journal'),
      withFallback(fetchBrands, fallbackBrands, 'brands'),
      // getCarHotspots already resolves resiliently (returns [] on failure) and the
      // Showreel self-falls-back to its placeholder stage when the list is empty.
      getCarHotspots().catch(() => [] as ResolvedCarHotspot[]),
      // No withFallback: this section's "empty" answer IS null (see fetchSpinTeaser).
      fetchSpinTeaser().catch((err) => {
        console.error('[homeData] spin teaser fetch failed, hiding the slide:', err);
        return null;
      }),
    ]);

  return { products, categories, testimonials, journalPosts, brands, carHotspots, spinTeaser };
}
