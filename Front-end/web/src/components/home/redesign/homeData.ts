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
  price: typeof p.price === 'number' ? formatPriceINR(p.price) : '',
  href: `/products/${p.slug || p._id}`,
  image: primaryImage(p.images),
});

const mapCategory = (c: ApiCategory, i: number): CategoryItem => ({
  tag: i === 0 ? 'Featured Category' : 'Category',
  name: c.name,
  href: c.slug ? `/categories/${c.slug}` : '/categories',
  image: c.image?.url || '',
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
  const res = await serverFetch<{ categories?: ApiCategory[] }>(
    `/categories?limit=200`,
    { next: { revalidate: REVALIDATE, tags: ['home:categories'] } }
  );
  // Hubs only = top-level categories (no parent). The list is pre-sorted by
  // `order` server-side, so the first N are the curated lead hubs.
  const hubs = (res.categories ?? []).filter((c) => !c.parent);
  return hubs.slice(0, LIMITS.categories).map(mapCategory);
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
  const res = await serverFetch<{ brands?: ApiBrand[] }>(
    `/brands?make=false&active=true&limit=${LIMITS.brands}`,
    { next: { revalidate: REVALIDATE, tags: ['home:brands'] } }
  );
  return (res.brands ?? []).map((b) => b.name).filter(Boolean);
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
  const [products, categories, testimonials, journalPosts, brands] = await Promise.all([
    withFallback(fetchProducts, fallbackProducts, 'products'),
    withFallback(fetchCategories, fallbackCategories, 'categories'),
    withFallback(fetchTestimonials, fallbackTestimonials, 'testimonials'),
    withFallback(fetchJournal, fallbackJournalPosts, 'journal'),
    withFallback(fetchBrands, fallbackBrands, 'brands'),
  ]);

  return { products, categories, testimonials, journalPosts, brands };
}
