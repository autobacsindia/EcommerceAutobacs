/**
 * Catalogue reads: products, categories, brands.
 *
 * The API returns full Mongo documents; the app works with a small, flat shape
 * so screens never dig through optional nesting. One place to normalise means
 * one place to fix when a field moves.
 */
import { api } from './client';

export interface ApiImage {
  url?: string;
  isPrimary?: boolean;
  alt?: string;
}

export interface RawSpec { key?: string; value?: string }

export interface RawVariant {
  _id?: string;
  label?: string;
  attributes?: { name?: string; option?: string }[];
  price?: number;
  originalPrice?: number | null;
  saleEndsAt?: string | null;
  stock?: 'in' | 'low' | 'out';
}

export interface RawProduct {
  _id: string;
  name: string;
  slug?: string;
  brand?: string;
  brandSlug?: string;
  price: number;
  originalPrice?: number | null;
  saleEndsAt?: string | null;
  offerEndDate?: string | null;
  averageRating?: number;
  totalReviews?: number;
  images?: ApiImage[];
  stock?: 'in' | 'low' | 'out';
  productType?: 'simple' | 'variable';
  variants?: RawVariant[];
  priceMin?: number;
  priceMax?: number;
  description?: string;
  shortDescription?: string;
  features?: string[];
  whyChoose?: string[];
  packageContents?: string[];
  specifications?: RawSpec[];
  returnPolicy?: { returnable?: boolean; cancellable?: boolean } | null;
  categories?: ({ _id?: string; name?: string; slug?: string } | string)[];
  complementaryProducts?: RawProduct[];
}

/** What every product card and detail screen in the app uses. */
/**
 * One buyable option of a `variable` product — a colour, a vehicle, a kit size.
 *
 * Every variant carries its OWN price and stock, which is why the product page
 * cannot show a single price until one is chosen: on the Hard Lid the two
 * options are ₹1,59,990 and ₹2,23,980.
 */
export interface Variant {
  id: string;
  label: string;
  /** The attribute this option belongs to, e.g. "Colour", "vehicle". */
  attribute: string;
  price: number;
  mrp: number | null;
  discountPercent: number;
  stock: 'in' | 'low' | 'out';
}

export interface Product {
  id: string;
  slug: string;
  name: string;
  brand: string;
  price: number;
  /** Only set when there is a genuine, still-running sale. */
  mrp: number | null;
  discountPercent: number;
  rating: number;
  reviews: number;
  image: string;
  images: string[];
  stock: 'in' | 'low' | 'out';
  /**
   * `variable` means the customer MUST choose a variant before this can be
   * added to a cart — the API rejects an add without one ("Please select a
   * variant before adding to cart").
   */
  productType: 'simple' | 'variable';
  variants: Variant[];
  /** Cheapest and dearest variant, for the "from ₹X" on a listing card. */
  priceFrom: number;
  priceTo: number;
  description: string;
  /** One-paragraph summary, shown under the price as on the website. */
  summary: string;
  features: string[];
  whyChoose: string[];
  packageContents: string[];
  /** The website's "Technical Specifications" table, in the order admin set. */
  specs: { key: string; value: string }[];
  returnable: boolean;
  /** Primary category — the breadcrumb and the "more in this category" link. */
  category: { name: string; slug: string } | null;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  image: string;
  parentId: string | null;
  /** The one-line blurb the website prints under a department heading. */
  description: string;
}

export interface Brand {
  name: string;
  slug: string;
  logo: string;
  productCount: number;
}

const imageUrls = (images?: ApiImage[]): string[] => {
  const list = (images ?? []).filter((i) => !!i.url);
  const primary = list.find((i) => i.isPrimary);
  const ordered = primary ? [primary, ...list.filter((i) => i !== primary)] : list;
  return ordered.map((i) => i.url!) as string[];
};

/** A sale whose window has closed is not a sale, even if the fields linger. */
function saleOf(price: number, originalPrice?: number | null, endsAt?: string | null) {
  const live = endsAt ? new Date(endsAt).getTime() > Date.now() : true;
  const on = typeof originalPrice === 'number' && originalPrice > price && live;
  return {
    mrp: on ? (originalPrice as number) : null,
    discountPercent: on ? Math.round((1 - price / (originalPrice as number)) * 100) : 0,
  };
}

function toVariant(v: RawVariant): Variant {
  const price = v.price ?? 0;
  const sale = saleOf(price, v.originalPrice, v.saleEndsAt);
  return {
    id: String(v._id ?? ''),
    // Every variant in this catalogue carries a human label; the attribute
    // option is the fallback for one that does not.
    label: v.label || v.attributes?.[0]?.option || 'Option',
    attribute: v.attributes?.[0]?.name || 'Option',
    price,
    mrp: sale.mrp,
    discountPercent: sale.discountPercent,
    stock: v.stock ?? 'in',
  };
}

export function toProduct(p: RawProduct): Product {
  const pics = imageUrls(p.images);
  const ends = p.saleEndsAt ?? p.offerEndDate ?? null;
  // A sale whose window has closed is not a sale, even if the fields linger.
  const live = ends ? new Date(ends).getTime() > Date.now() : true;
  const onSale = typeof p.originalPrice === 'number' && p.originalPrice > p.price && live;
  return {
    id: p._id,
    slug: p.slug ?? p._id,
    name: p.name,
    brand: p.brand ?? '',
    price: p.price,
    mrp: onSale ? (p.originalPrice as number) : null,
    discountPercent: onSale ? Math.round((1 - p.price / (p.originalPrice as number)) * 100) : 0,
    rating: p.averageRating ?? 0,
    reviews: p.totalReviews ?? 0,
    image: pics[0] ?? '',
    images: pics,
    stock: p.stock ?? 'in',
    productType: p.productType === 'variable' ? 'variable' : 'simple',
    variants: (p.variants ?? []).map(toVariant).filter((v) => !!v.id),
    priceFrom: p.priceMin ?? p.price,
    priceTo: p.priceMax ?? p.price,
    description: p.description ?? '',
    summary: p.shortDescription ?? '',
    features: p.features ?? [],
    whyChoose: p.whyChoose ?? [],
    packageContents: p.packageContents ?? [],
    specs: (p.specifications ?? [])
      .filter((s) => !!s?.key && !!s?.value)
      .map((s) => ({ key: s.key as string, value: s.value as string })),
    // Absent means the default policy applies, which is returnable.
    returnable: p.returnPolicy?.returnable !== false,
    category: firstCategory(p.categories),
  };
}

/**
 * The product's primary category as { name, slug }.
 *
 * The listing endpoint sends categories as plain id strings while the detail
 * endpoint sends populated objects, so this accepts both and simply yields null
 * for the id-only shape — a card has no use for a breadcrumb anyway.
 */
function firstCategory(
  cats?: ({ _id?: string; name?: string; slug?: string } | string)[],
): { name: string; slug: string } | null {
  const first = (cats ?? []).find((c) => typeof c === 'object' && !!c?.name && !!c?.slug);
  return first && typeof first === 'object'
    ? { name: first.name as string, slug: first.slug as string }
    : null;
}

/** Products only make sense in a list once they have a name, a price and a photo. */
const listable = (p: Product) => !!p.name && p.price > 0 && !!p.image;

export interface ProductQuery {
  search?: string;
  category?: string;
  /** One or more brand NAMES. The API repeats the param for a multi-select. */
  brand?: string | string[];
  vehicleMake?: string;
  vehicleModel?: string;
  sort?: string;
  minPrice?: number;
  maxPrice?: number;
  /** Minimum star ratings to include, e.g. [4] for "4 stars and up". */
  rating?: number[];
  /** Hide anything the admin has marked out of stock. */
  inStock?: boolean;
  page?: number;
  limit?: number;
}

export async function fetchProducts(q: ProductQuery = {}, signal?: AbortSignal) {
  const params = new URLSearchParams();
  params.set('limit', String(q.limit ?? 20));
  if (q.page && q.page > 1) params.set('page', String(q.page));
  if (q.search) params.set('search', q.search);
  if (q.category) params.set('category', q.category);
  // Repeated rather than comma-joined: the API reads brand as a list, and a
  // brand whose own name contains a comma would otherwise split into two.
  for (const b of Array.isArray(q.brand) ? q.brand : q.brand ? [q.brand] : []) params.append('brand', b);
  if (q.vehicleMake) params.set('vehicleMake', q.vehicleMake);
  if (q.vehicleModel) params.set('vehicleModel', q.vehicleModel);
  if (q.sort) params.set('sort', q.sort);
  if (q.minPrice != null) params.set('minPrice', String(q.minPrice));
  if (q.maxPrice != null) params.set('maxPrice', String(q.maxPrice));
  for (const r of q.rating ?? []) params.append('rating', String(r));
  if (q.inStock) params.set('inStock', 'true');

  const res = await api.get<{ products?: RawProduct[]; total?: number; pages?: number }>(
    `/products?${params}`,
    signal,
  );
  return {
    products: (res.products ?? []).map(toProduct).filter(listable),
    total: res.total ?? 0,
    pages: res.pages ?? 1,
  };
}

export async function fetchProduct(slug: string, signal?: AbortSignal): Promise<Product> {
  const res = await api.get<{ product?: RawProduct } & RawProduct>(`/products/slug/${encodeURIComponent(slug)}`, signal);
  const raw = (res.product ?? res) as RawProduct;
  return toProduct(raw);
}

export async function fetchOffers(limit = 20, signal?: AbortSignal): Promise<Product[]> {
  const res = await api.get<{ products?: RawProduct[] }>(`/products/offers?limit=${limit}`, signal);
  return (res.products ?? []).map(toProduct).filter(listable);
}

export async function fetchCategories(signal?: AbortSignal): Promise<Category[]> {
  const res = await api.get<{
    categories?: {
      _id: string; name: string; slug?: string; description?: string;
      image?: { url?: string }; parent?: unknown;
    }[];
  }>('/categories?limit=200&v=2', signal);
  return (res.categories ?? [])
    .filter((c) => !!c.name && !!c.slug)
    .map((c) => ({
      id: c._id,
      name: c.name,
      slug: c.slug as string,
      image: c.image?.url ?? '',
      description: c.description ?? '',
      parentId: c.parent ? String(typeof c.parent === 'string' ? c.parent : (c.parent as { _id: string })._id) : null,
    }));
}

export async function fetchBrands(signal?: AbortSignal): Promise<Brand[]> {
  const res = await api.get<{ brands?: { name?: string; slug?: string; logo?: string | null; productCount?: number }[] }>(
    '/products/brands',
    signal,
  );
  return (res.brands ?? [])
    .filter((b) => !!b.name && !!b.slug)
    .map((b) => ({ name: b.name!, slug: b.slug!, logo: b.logo ?? '', productCount: b.productCount ?? 0 }))
    .sort((a, b) => b.productCount - a.productCount);
}

export interface Suggestion {
  id: string;
  text: string;
  slug?: string;
  type?: string;
  imageUrl?: string;
  category?: string;
}

/** Search-as-you-type. The API ignores one-character queries. */
export async function fetchSuggestions(q: string, signal?: AbortSignal): Promise<Suggestion[]> {
  if (q.trim().length < 2) return [];
  const res = await api.get<{ suggestions?: Suggestion[] }>(
    `/products/suggestions?q=${encodeURIComponent(q.trim())}&limit=8`,
    signal,
  );
  return res.suggestions ?? [];
}

/** Car makes we stock, e.g. ["BMW", "Toyota", …]. */
export async function fetchVehicleMakes(signal?: AbortSignal): Promise<string[]> {
  const res = await api.get<{ makes?: string[] }>('/vehicles/makes', signal);
  return res.makes ?? [];
}

export interface VehicleModel {
  make: string;
  model: string;
  slug: string;
}

/**
 * Every vehicle we stock parts for. The list is small and the API ignores a
 * `make` filter, so it is fetched once and grouped in the app.
 */
export async function fetchVehicles(signal?: AbortSignal): Promise<VehicleModel[]> {
  const res = await api.get<{ vehicles?: { make?: string; model?: string; slug?: string }[] }>(
    '/vehicles?limit=500',
    signal,
  );
  return (res.vehicles ?? [])
    .filter((v) => !!v.make && !!v.model)
    .map((v) => ({ make: v.make as string, model: v.model as string, slug: v.slug ?? '' }))
    .sort((a, b) => a.make.localeCompare(b.make) || a.model.localeCompare(b.model));
}

export interface Testimonial {
  id: string;
  name: string;
  rating: number;
  comment: string;
  verified: boolean;
  productName?: string;
}

/** Real customer reviews, the same ones the website's home page shows. */
export async function fetchTestimonials(limit = 8, signal?: AbortSignal): Promise<Testimonial[]> {
  const res = await api.get<{
    testimonials?: {
      id?: string; name?: string; rating?: number; comment?: string;
      isVerifiedPurchase?: boolean; product?: { name?: string } | null;
    }[];
  }>(// No `?limit`: the API is cached at Cloudflare's edge keyed on the full
    // url and purged by exact match, so a query string here would leave the
    // app showing testimonials the website had already replaced. The endpoint
    // returns 12; the app slices what it needs.
    `/reviews/testimonials`, signal);
  return (res.testimonials ?? [])
    .filter((t) => !!t.comment && !!t.name)
    .slice(0, limit)
    .map((t, i) => ({
      id: t.id ?? String(i),
      name: t.name as string,
      rating: t.rating ?? 5,
      comment: t.comment as string,
      verified: !!t.isVerifiedPurchase,
      productName: t.product?.name,
    }));
}

// ── Facets ───────────────────────────────────────────────────────────────────
/**
 * The filter options that actually exist for a given query, with counts.
 *
 * `/products/facets` takes the SAME parameters as `/products`, so the options
 * it returns describe the result set the customer is looking at — not the
 * whole catalogue. That is what makes a count trustworthy: "Bushranger 14"
 * means fourteen here, and a brand with nothing in this department never
 * appears at all, so no filter can lead to an empty grid.
 */
export interface Facets {
  total: number;
  brands: { value: string; count: number }[];
  vehicleMakes: { value: string; count: number }[];
  vehicleModels: { value: string; make: string; count: number }[];
  ratings: { value: number; count: number }[];
  availability: { value: string; label: string; count: number }[];
  price: { min: number; max: number } | null;
  /** Price bands with counts, straight from the API — drives the band list. */
  priceBands: { from: number; to: number; count: number }[];
}

export async function fetchFacets(q: ProductQuery = {}, signal?: AbortSignal): Promise<Facets> {
  const params = new URLSearchParams();
  if (q.search) params.set('search', q.search);
  if (q.category) params.set('category', q.category);
  for (const b of Array.isArray(q.brand) ? q.brand : q.brand ? [q.brand] : []) params.append('brand', b);
  if (q.vehicleMake) params.set('vehicleMake', q.vehicleMake);
  if (q.vehicleModel) params.set('vehicleModel', q.vehicleModel);
  if (q.minPrice != null) params.set('minPrice', String(q.minPrice));
  if (q.maxPrice != null) params.set('maxPrice', String(q.maxPrice));
  for (const r of q.rating ?? []) params.append('rating', String(r));
  if (q.inStock) params.set('inStock', 'true');

  /*
    The payload is enveloped: { success, facets: { ... } }. Reading the fields
    off the top level silently yields an empty filter with "Show 0 results" —
    a 200 response that looks like a working request and an empty catalogue.
    `?? envelope` keeps this working if the envelope is ever dropped.
  */
  type FacetBody = {
    total?: number;
    brands?: { value?: string; name?: string; count?: number }[];
    vehicleMakes?: { value?: string; count?: number }[];
    vehicleModels?: { value?: string; make?: string; count?: number }[];
    ratings?: { value?: number; count?: number }[];
    availability?: { value?: string; label?: string; count?: number }[];
    price?: { min?: number; max?: number; histogram?: { from?: number; to?: number; count?: number }[] };
  };
  const envelope = await api.get<{ facets?: FacetBody } & FacetBody>(
    `/products/facets?${params}`,
    signal,
  );
  const res: FacetBody = envelope.facets ?? envelope;

  const list = <T,>(v: T[] | undefined) => (Array.isArray(v) ? v : []);
  return {
    total: res.total ?? 0,
    brands: list(res.brands)
      .map((b) => ({ value: String(b.value ?? b.name ?? ''), count: Number(b.count ?? 0) }))
      .filter((b) => b.value),
    vehicleMakes: list(res.vehicleMakes)
      .map((m) => ({ value: String(m.value ?? ''), count: Number(m.count ?? 0) }))
      .filter((m) => m.value),
    vehicleModels: list(res.vehicleModels)
      .map((m) => ({ value: String(m.value ?? ''), make: String(m.make ?? ''), count: Number(m.count ?? 0) }))
      .filter((m) => m.value),
    ratings: list(res.ratings)
      .map((r) => ({ value: Number(r.value ?? 0), count: Number(r.count ?? 0) }))
      .filter((r) => r.value > 0),
    availability: list(res.availability)
      .map((a) => ({ value: String(a.value ?? ''), label: String(a.label ?? a.value ?? ''), count: Number(a.count ?? 0) }))
      .filter((a) => a.value),
    // A single-product result has min === max, which is not a range worth drawing.
    price:
      res.price && Number.isFinite(res.price.min) && Number.isFinite(res.price.max) && res.price.max! > res.price.min!
        ? { min: Math.floor(res.price.min!), max: Math.ceil(res.price.max!) }
        : null,
    priceBands: list(res.price?.histogram)
      .map((h) => ({ from: Number(h.from ?? 0), to: Number(h.to ?? 0), count: Number(h.count ?? 0) }))
      .filter((h) => h.count > 0 && h.to > h.from),
  };
}

// ── reviews ──────────────────────────────────────────────────────────────────

export interface Review {
  id: string;
  name: string;
  rating: number;
  title: string;
  comment: string;
  verified: boolean;
  createdAt: string;
}

export interface ReviewSummary {
  average: number;
  total: number;
  /** Count per star, 1-5. Drives the distribution bars on the product page. */
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
}

/**
 * The rating breakdown shown above the review list.
 *
 * Kept separate from the list because the website shows the bars before any
 * review has loaded, and a product with hundreds of reviews should not have to
 * ship them all to draw five bars.
 */
export async function fetchReviewSummary(productId: string, signal?: AbortSignal): Promise<ReviewSummary> {
  const res = await api.get<{
    summary?: {
      averageRating?: number;
      totalReviews?: number;
      ratingDistribution?: Record<string, number>;
    };
  }>(`/reviews/products/${productId}/summary`, signal);
  const d = res.summary?.ratingDistribution ?? {};
  return {
    average: res.summary?.averageRating ?? 0,
    total: res.summary?.totalReviews ?? 0,
    distribution: {
      1: d['1'] ?? 0,
      2: d['2'] ?? 0,
      3: d['3'] ?? 0,
      4: d['4'] ?? 0,
      5: d['5'] ?? 0,
    },
  };
}

/** The most recent reviews for one product. */
export async function fetchReviews(productId: string, limit = 5, signal?: AbortSignal): Promise<Review[]> {
  const res = await api.get<{
    reviews?: {
      _id?: string; id?: string; rating?: number; title?: string; comment?: string;
      isVerifiedPurchase?: boolean; createdAt?: string;
      user?: { name?: string } | null; name?: string;
    }[];
  }>(`/reviews/products/${productId}?limit=${limit}`, signal);
  return (res.reviews ?? [])
    .filter((r) => !!r.comment)
    .map((r, i) => ({
      id: r._id ?? r.id ?? String(i),
      name: r.user?.name ?? r.name ?? 'Verified buyer',
      rating: r.rating ?? 5,
      title: r.title ?? '',
      comment: r.comment as string,
      verified: !!r.isVerifiedPurchase,
      createdAt: r.createdAt ?? '',
    }));
}

/**
 * "Frequently bought together" — the admin-curated complementary products.
 *
 * They ride along on the product document, so this re-reads the detail payload
 * rather than adding an endpoint the backend does not have.
 */
export async function fetchComplementary(slug: string, signal?: AbortSignal): Promise<Product[]> {
  const res = await api.get<{ product?: RawProduct } & RawProduct>(
    `/products/slug/${encodeURIComponent(slug)}`,
    signal,
  );
  const raw = (res.product ?? res) as RawProduct;
  return (raw.complementaryProducts ?? []).map(toProduct).filter(listable);
}
