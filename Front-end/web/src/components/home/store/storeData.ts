/**
 * Data for the light, Amazon-style store home page.
 *
 * Server-only (imported by an async Server Component). Every row reads REAL
 * catalogue data — nothing here invents a deal, a best seller or a rating:
 *   - Today's Deals  → /products/offers: products with a genuine MRP above the price
 *   - Best Sellers   → sorted by `salesScore`, the nightly score derived from PAID
 *                      orders; products that have never sold are dropped
 *   - New Arrivals   → newest first
 *   - "Top in …"     → per category, best-selling first; empty categories are skipped
 * Each fetch degrades to an empty list, and an empty row is simply not rendered.
 */
import { serverFetch } from '@/lib/server-api';

const REVALIDATE = 300;
const TAGS = { products: 'home:products', categories: 'home:categories' };

export interface StoreProduct {
  id: string;
  name: string;
  href: string;
  image: string;
  brand: string;
  price: number;
  /** The genuine "was" price — present only when the product is really on sale. */
  originalPrice?: number;
  /** ISO end of the sale window, when the sale has one. */
  offerEndDate?: string;
  rating: number;
  reviews: number;
}

export interface StoreCategory {
  name: string;
  slug: string;
  href: string;
  image: string;
}

export interface StoreReview {
  quote: string;
  name: string;
  rating: number;
  verified: boolean;
  product?: { name: string; href: string; image?: string };
}

export interface StoreBrand {
  name: string;
  href: string;
  logo: string;
}

export interface StoreCategoryRow {
  category: StoreCategory;
  products: StoreProduct[];
}

export interface StoreHomeData {
  categories: StoreCategory[];
  deals: StoreProduct[];
  /** How many products are on sale in total (the deals row shows a slice). */
  dealsTotal: number;
  bestSellers: StoreProduct[];
  newArrivals: StoreProduct[];
  categoryRows: StoreCategoryRow[];
  brands: StoreBrand[];
  reviews: StoreReview[];
}

interface ApiImage { url?: string; isPrimary?: boolean }
interface ApiProduct {
  _id: string;
  name: string;
  slug?: string;
  brand?: string;
  price: number;
  originalPrice?: number | null;
  offerEndDate?: string | null;
  averageRating?: number;
  totalReviews?: number;
  salesScore?: number;
  images?: ApiImage[];
}
interface ApiCategory { _id: string; name: string; slug?: string; parent?: unknown; image?: { url?: string } }

const primaryImage = (images?: ApiImage[]) => (images?.find((i) => i.isPrimary) ?? images?.[0])?.url ?? '';

export const toStoreProduct = (p: ApiProduct): StoreProduct => {
  const onSale = typeof p.originalPrice === 'number' && p.originalPrice > p.price;
  // A sale whose window already closed is not a deal, even if the nightly sweep
  // has not normalised the stored fields yet.
  const ended = p.offerEndDate ? new Date(p.offerEndDate).getTime() <= Date.now() : false;
  return {
    id: p._id,
    name: p.name,
    href: `/products/${p.slug || p._id}`,
    image: primaryImage(p.images),
    brand: p.brand || '',
    price: p.price,
    ...(onSale && !ended && { originalPrice: p.originalPrice as number }),
    ...(onSale && !ended && p.offerEndDate && { offerEndDate: p.offerEndDate }),
    rating: p.averageRating || 0,
    reviews: p.totalReviews || 0,
  };
};

/** Whole-number percentage off, or 0 when not on sale. */
export const discountPct = (p: Pick<StoreProduct, 'price' | 'originalPrice'>) =>
  p.originalPrice && p.originalPrice > p.price ? Math.round((1 - p.price / p.originalPrice) * 100) : 0;

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.error('[store-home] section failed:', (err as Error).message);
    return fallback;
  }
}

const productList = async (query: string): Promise<ApiProduct[]> => {
  const res = await serverFetch<{ products?: ApiProduct[] }>(`/products?${query}`, {
    next: { revalidate: REVALIDATE, tags: [TAGS.products] },
  });
  return res.products ?? [];
};

const usable = (p: ApiProduct) => !!p.name && typeof p.price === 'number' && p.price > 0 && !!primaryImage(p.images);

/** Categories most likely to fill a "Top in …" row, tried in this order. */
const ROW_CANDIDATES = ['lighting', 'exterior', 'performance', 'accessories', 'interior', 'body-kits', 'suspension', 'audio'];
const MAX_CATEGORY_ROWS = 3;

export async function getStoreHomeData(): Promise<StoreHomeData> {
  const categoriesP = safe(async () => {
    const res = await serverFetch<{ categories?: ApiCategory[] }>(`/categories?limit=200&v=2`, {
      next: { revalidate: REVALIDATE, tags: [TAGS.categories] },
    });
    return (res.categories ?? [])
      .filter((c) => !c.parent && c.slug)
      .map((c) => ({ name: c.name, slug: c.slug!, href: `/categories/${c.slug}`, image: c.image?.url || '' }));
  }, [] as StoreCategory[]);

  const dealsP = safe(async () => {
    const res = await serverFetch<{ products?: ApiProduct[]; total?: number }>(`/products/offers?limit=24`, {
      next: { revalidate: REVALIDATE, tags: [TAGS.products] },
    });
    const list = (res.products ?? []).filter(usable).map(toStoreProduct).filter((p) => discountPct(p) > 0)
      .sort((a, b) => discountPct(b) - discountPct(a)).slice(0, 16);
    return { list, total: Math.max(res.total ?? 0, list.length) };
  }, { list: [] as StoreProduct[], total: 0 });

  const bestP = safe(async () => (await productList('sortBy=salesScore&sortOrder=desc&limit=24'))
    .filter((p) => usable(p) && (p.salesScore ?? 0) > 0).map(toStoreProduct).slice(0, 16), [] as StoreProduct[]);

  const newP = safe(async () => (await productList('sortBy=createdAt&sortOrder=desc&limit=16'))
    .filter(usable).map(toStoreProduct), [] as StoreProduct[]);

  const brandsP = safe(async () => {
    const res = await serverFetch<{ brands?: { name: string; slug?: string; logo?: string | null; productCount?: number }[] }>(
      `/products/brands?limit=200`, { next: { revalidate: REVALIDATE, tags: [TAGS.products] } });
    // Brands with a logo, most products first — the ones a shopper recognises.
    return (res.brands ?? [])
      .filter((b) => b.name && b.slug && b.logo)
      .sort((a, b) => (b.productCount ?? 0) - (a.productCount ?? 0))
      .slice(0, 16)
      .map((b) => ({ name: b.name, href: `/brands/${b.slug}`, logo: b.logo! }));
  }, [] as StoreBrand[]);

  const reviewsP = safe(async () => {
    const res = await serverFetch<{ testimonials?: Array<{ name?: string; title?: string; comment?: string; rating?: number; isVerifiedPurchase?: boolean; product?: { name?: string; slug?: string; image?: string | null } | null }> }>(
      `/reviews/testimonials?limit=8`, { next: { revalidate: REVALIDATE, tags: ['home:testimonials'] } });
    return (res.testimonials ?? []).filter((t) => t.comment || t.title).map((t) => ({
      quote: (t.comment || t.title)!,
      name: t.name || 'Customer',
      rating: Math.max(1, Math.min(5, Math.round(t.rating ?? 5))),
      verified: t.isVerifiedPurchase === true,
      ...(t.product?.name && t.product.slug && {
        product: { name: t.product.name, href: `/products/${t.product.slug}`, image: t.product.image || undefined },
      }),
    }));
  }, [] as StoreReview[]);

  const categories = await categoriesP;
  const bySlug = new Map(categories.map((c) => [c.slug, c]));
  const candidates = ROW_CANDIDATES.map((s) => bySlug.get(s)).filter(Boolean) as StoreCategory[];
  const rowsP = Promise.all(candidates.map((c) => safe(async () => ({
    category: c,
    products: (await productList(`category=${encodeURIComponent(c.slug)}&sortBy=salesScore&sortOrder=desc&limit=12`))
      .filter(usable).map(toStoreProduct),
  }), { category: c, products: [] as StoreProduct[] })));

  const [deals, bestSellers, newArrivals, brands, reviews, rows] = await Promise.all([dealsP, bestP, newP, brandsP, reviewsP, rowsP]);
  return {
    categories,
    deals: deals.list,
    dealsTotal: deals.total,
    bestSellers,
    newArrivals,
    categoryRows: rows.filter((r) => r.products.length >= 4).slice(0, MAX_CATEGORY_ROWS),
    brands,
    reviews,
  };
}
