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
  brand?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  sort?: string;
  minPrice?: number;
  maxPrice?: number;
  page?: number;
  limit?: number;
}

export async function fetchProducts(q: ProductQuery = {}, signal?: AbortSignal) {
  const params = new URLSearchParams();
  params.set('limit', String(q.limit ?? 20));
  if (q.page && q.page > 1) params.set('page', String(q.page));
  if (q.search) params.set('search', q.search);
  if (q.category) params.set('category', q.category);
  if (q.brand) params.set('brand', q.brand);
  if (q.vehicleMake) params.set('vehicleMake', q.vehicleMake);
  if (q.vehicleModel) params.set('vehicleModel', q.vehicleModel);
  if (q.sort) params.set('sort', q.sort);
  if (q.minPrice != null) params.set('minPrice', String(q.minPrice));
  if (q.maxPrice != null) params.set('maxPrice', String(q.maxPrice));

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
    categories?: { _id: string; name: string; slug?: string; image?: { url?: string }; parent?: unknown }[];
  }>('/categories?limit=200&v=2', signal);
  return (res.categories ?? [])
    .filter((c) => !!c.name && !!c.slug)
    .map((c) => ({
      id: c._id,
      name: c.name,
      slug: c.slug as string,
      image: c.image?.url ?? '',
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
