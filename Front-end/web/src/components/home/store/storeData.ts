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
import type { FestivalOfferSetting } from '@/lib/festival/festivalOffer';
import { getStockStatus, type StockStatus } from '@/lib/stock';
import { HOME_SHELF_ORDER, buildPremiumPicks, orderShelf } from './shelfOrder';

const REVALIDATE = 300;
/*
  `brands` is listed here because the backend has always emitted `home:brands`
  on a brand create/update (routes/brands.js) — but the brand strip below was
  tagged `home:products`, so that signal reached only the retired
  components/home/redesign/homeData.ts. Nothing invalidated the live homepage,
  and an edited logo stayed visible until the 300s window lapsed. Seen for real
  when a brand logo was repointed off Cloudinary and the old one kept serving.
*/
const TAGS = { products: 'home:products', categories: 'home:categories', brands: 'home:brands', press: 'home:press' };

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
  /**
   * A variable product: `price` is not one model's exact price, so the Diwali offer
   * (tiered per unit price) is not shown on its tile — the PDP shows it per model.
   */
  variable?: boolean;
  festivalOfferSetting?: FestivalOfferSetting | null;
  /** Coarse availability; 'out'/'backorder' tiles sort last on every shelf. */
  stock: StockStatus;
  /** Slug of the product's first category, when the API sent it (used to vary the hero). */
  category?: string;
  /**
   * 1-based position in the best-seller ranking. Shelves are shown premium-first, so
   * a tile's position is no longer its sales rank — the "#1 Best seller" badge reads
   * this instead, so it stays true.
   */
  salesRank?: number;
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

/** A featured press item for the home "As featured in" strip (links out). */
export interface StorePress {
  id: string;
  publication: string;
  date: string;
  headline: string;
  excerpt: string;
  url: string;
  image: string;
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
  /** Every active product in the catalogue (0 when unknown). */
  productTotal: number;
  bestSellers: StoreProduct[];
  newArrivals: StoreProduct[];
  /** Admin-picked products. The hero banners prefer these for their photos. */
  featured: StoreProduct[];
  /** Featured first, topped up with the dearest buyable products (see shelfOrder.ts). */
  premiumPicks: StoreProduct[];
  /** The dearest buyable products: the pool Premium Picks is topped up from. */
  dearest: StoreProduct[];
  categoryRows: StoreCategoryRow[];
  brands: StoreBrand[];
  reviews: StoreReview[];
  /** Featured, published press items (max PRESS_LIMIT). Optional so fixtures without it still type-check. */
  press?: StorePress[];
}

interface ApiImage { url?: string; isPrimary?: boolean }
interface ApiProduct {
  _id: string;
  name: string;
  slug?: string;
  brand?: string;
  /** Populated on the public list routes: `[{ _id, name, slug }]`. */
  categories?: Array<{ slug?: string } | string>;
  price: number;
  originalPrice?: number | null;
  festivalOfferSetting?: FestivalOfferSetting | null;
  offerEndDate?: string | null;
  productType?: string;
  stock?: string | number | null;
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
    ...(p.productType === 'variable' && { variable: true }),
    ...(p.festivalOfferSetting && { festivalOfferSetting: p.festivalOfferSetting }),
    stock: getStockStatus(p),
    ...(firstCategorySlug(p) && { category: firstCategorySlug(p) }),
  };
};

const firstCategorySlug = (p: ApiProduct): string | undefined => {
  const c = p.categories?.[0];
  return c && typeof c === 'object' && c.slug ? c.slug : undefined;
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

const productPage = async (query: string): Promise<{ products: ApiProduct[]; total: number }> => {
  const res = await serverFetch<{ products?: ApiProduct[]; total?: number }>(`/products?${query}`, {
    next: { revalidate: REVALIDATE, tags: [TAGS.products] },
  });
  return { products: res.products ?? [], total: typeof res.total === 'number' && res.total > 0 ? res.total : 0 };
};
const productList = async (query: string): Promise<ApiProduct[]> => (await productPage(query)).products;

interface ApiPress { _id: string; publication?: string; date?: string; headline?: string; excerpt?: string; url?: string; image?: string; featured?: boolean }

/** How many press cards the home strip shows at most. */
export const PRESS_LIMIT = 3;
const isWebUrl = (u?: string) => !!u && /^https?:\/\//i.test(u);
/** An image may also be one of our own files (e.g. /images/press/…), but never protocol-relative `//host`. */
const isImageSrc = (u?: string) => isWebUrl(u) || (!!u && u.startsWith('/') && !u.startsWith('//'));

/**
 * Featured press only, so the admin decides what earns home-page space (the
 * /media page lists the rest). The endpoint already returns published items,
 * featured first. A non-http(s) link is dropped rather than rendered as an href.
 */
export const toStorePress = (items: ApiPress[]): StorePress[] =>
  items
    .filter((p) => p.featured && p.headline && p.publication && isWebUrl(p.url))
    .slice(0, PRESS_LIMIT)
    .map((p) => ({
      id: p._id,
      publication: p.publication!,
      date: p.date || '',
      headline: p.headline!,
      excerpt: p.excerpt || '',
      url: p.url!,
      image: isImageSrc(p.image) ? p.image! : '',
    }));

const usable = (p: ApiProduct) => !!p.name && typeof p.price === 'number' && p.price > 0 && !!primaryImage(p.images);

/** Categories most likely to fill a "Top in …" row, tried in this order. */
const ROW_CANDIDATES = ['lighting', 'exterior', 'performance', 'accessories', 'interior', 'body-kits', 'suspension', 'audio'];
/** How many "Top in …" rows the home page shows. */
export const MAX_CATEGORY_ROWS = 3;
/** A product row with fewer than this many products looks broken and is not shown. */
export const MIN_ROW = 4;
/** Products shown in one "Top in …" row. */
export const CATEGORY_ROW_SIZE = 12;

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
    let list = (res.products ?? []).filter(usable).map(toStoreProduct).filter((p) => discountPct(p) > 0)
      .sort((a, b) => discountPct(b) - discountPct(a));
    // Biggest saving decides membership when there are more than 16; the shelf then
    // shows them premium-first (see shelfOrder.ts).
    list = orderShelf(list.slice(0, 16), HOME_SHELF_ORDER.deals);
    return { list, total: Math.max(res.total ?? 0, list.length) };
  }, { list: [] as StoreProduct[], total: 0 });

  // Membership = the top sellers (up to 24 fetched, 16 shown); order = premium-first.
  const bestP = safe(async () => orderShelf(
    (await productList('sortBy=salesScore&sortOrder=desc&limit=24'))
      .filter((p) => usable(p) && (p.salesScore ?? 0) > 0)
      .map((p, i) => ({ ...toStoreProduct(p), salesRank: i + 1 }))
      .slice(0, 16),
    HOME_SHELF_ORDER.bestSellers,
  ), [] as StoreProduct[]);

  // The unfiltered public list: its `total` is every ACTIVE product (the public
  // route never lifts the active filter), so the Black Friday hero's catalogue-
  // wide count comes from this same request — no extra call.
  const newP = safe(async () => {
    const page = await productPage('sortBy=createdAt&sortOrder=desc&limit=16');
    return {
      list: orderShelf(page.products.filter(usable).map(toStoreProduct), HOME_SHELF_ORDER.newArrivals),
      total: page.total,
    };
  }, { list: [] as StoreProduct[], total: 0 });

  /*
    The dearest BUYABLE products, for topping up "Premium Picks". Sorted by the
    backend (Atlas `price` sort, led by stockRank) and bounded; `inStock=true`
    excludes out AND backorder on both engines. Same `sortBy=price` the catalogue's
    "Price: high to low" already uses — no new query shape.
  */
  const dearestP = safe(
    async () => (await productList('sortBy=price&sortOrder=desc&order=desc&inStock=true&limit=24')).filter(usable).map(toStoreProduct),
    [] as StoreProduct[],
  );

  /*
    Products the admin has ticked "Featured".

    The hero's three photographs used to be whatever the algorithm put first —
    the biggest discount, the top seller, the newest row. That is correct and
    frequently unattractive: the deepest discount on the catalogue was a set of
    key cases, so the "Up to 58% off" banner advertised key cases. No ranking
    rule fixes that, because "interesting" is a judgement.

    So the banners prefer featured products and fall back to the ranked lists
    when fewer than three are marked. Ticking the box on the product form is now
    the whole mechanism — no new field, no migration.
  */
  const featuredP = safe(
    async () => (await productList('isFeatured=true&limit=12')).filter(usable).map(toStoreProduct),
    [] as StoreProduct[],
  );

  const brandsP = safe(async () => {
    const res = await serverFetch<{ brands?: { name: string; slug?: string; logo?: string | null; productCount?: number }[] }>(
      // Both tags: a brand edit changes the name/logo, a product change alters
      // the counts this strip sorts by.
      `/products/brands?limit=200`, { next: { revalidate: REVALIDATE, tags: [TAGS.brands, TAGS.products] } });
    // EVERY brand, most products first — logos where we have them, the name
    // otherwise. The strip scrolls sideways in two rows, so none is left out.
    return (res.brands ?? [])
      .filter((b) => b.name && b.slug)
      .sort((a, b) => (b.productCount ?? 0) - (a.productCount ?? 0))
      .map((b) => ({ name: b.name, href: `/brands/${b.slug}`, logo: b.logo || '' }));
  }, [] as StoreBrand[]);

  const reviewsP = safe(async () => {
    const res = await serverFetch<{ testimonials?: Array<{ name?: string; title?: string; comment?: string; rating?: number; isVerifiedPurchase?: boolean; product?: { name?: string; slug?: string; image?: string | null } | null }> }>(
      // No `?limit`: Cloudflare keys its cache on the FULL url and purges by exact match, so a query string makes this endpoint unpurgeable (see config/cdnPurgeUrls.js). The endpoint defaults to 12, more than any caller shows.
      `/reviews/testimonials`, { next: { revalidate: REVALIDATE, tags: ['home:testimonials'] } });
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

  // Tagged `home:press`: every press create/edit/delete revalidates it (routes/media.js).
  const pressP = safe(async () => {
    const res = await serverFetch<{ data?: ApiPress[] }>(`/media/press`, {
      next: { revalidate: REVALIDATE, tags: [TAGS.press] },
    });
    return toStorePress(res.data ?? []);
  }, [] as StorePress[]);

  const categories = await categoriesP;
  const bySlug = new Map(categories.map((c) => [c.slug, c]));
  const candidates = ROW_CANDIDATES.map((s) => bySlug.get(s)).filter(Boolean) as StoreCategory[];
  const rowsP = Promise.all(candidates.map((c) => safe(async () => ({
    category: c,
    products: orderShelf(
      // 20, not 12: the page shows 12, and the spare ones refill a row whose top
      // sellers already appear higher up the page (see uniqueShelves.ts).
      (await productList(`category=${encodeURIComponent(c.slug)}&sortBy=salesScore&sortOrder=desc&limit=20`))
        .filter(usable).map(toStoreProduct),
      HOME_SHELF_ORDER.categoryRows,
    ),
  }), { category: c, products: [] as StoreProduct[] })));

  const [deals, bestSellers, newest, featured, dearest, brands, reviews, rows, press] = await Promise.all([
    dealsP, bestP, newP, featuredP, dearestP, brandsP, reviewsP, rowsP, pressP,
  ]);
  return {
    categories,
    deals: deals.list,
    dealsTotal: deals.total,
    productTotal: newest.total,
    bestSellers,
    newArrivals: newest.list,
    featured,
    premiumPicks: buildPremiumPicks(featured, dearest),
    dearest,
    // Every candidate with enough products, in preference order; the page picks
    // the first MAX_CATEGORY_ROWS that still have enough once repeats are removed.
    categoryRows: rows.filter((r) => r.products.length >= MIN_ROW),
    brands,
    reviews,
    press,
  };
}
