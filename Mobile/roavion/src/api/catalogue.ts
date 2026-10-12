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
  description?: string;
  features?: string[];
  packageContents?: string[];
  categories?: string[];
}

/** What every product card and detail screen in the app uses. */
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
  description: string;
  features: string[];
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
    description: p.description ?? '',
    features: p.features ?? [],
  };
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
  }>(`/reviews/testimonials?limit=${limit}`, signal);
  return (res.testimonials ?? [])
    .filter((t) => !!t.comment && !!t.name)
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
    price?: { min?: number; max?: number };
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
  };
}
