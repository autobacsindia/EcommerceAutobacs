// Define types for our data models

export interface Category {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  parent?: Category | string;
  image?: {
    url: string;
    alt?: string;
  };
  isActive: boolean;
  order: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProductImage {
  url: string;
  alt?: string;
  isPrimary?: boolean;
  _id?: string;
}

export interface ProductSpecification {
  key: string;
  value: string;
  _id?: string;
}

export interface Product {
  _id: string;
  name: string;
  slug?: string;
  description: string;
  shortDescription?: string;
  price: number;
  originalPrice?: number;
  category?: Category | string;
  categories?: Category[];
  brand?: string;
  images: ProductImage[] | string;
  stock: number;
  sku?: string;
  specifications?: ProductSpecification[] | string;
  features?: string[] | string;
  isActive: boolean;
  isFeatured: boolean;
  averageRating: number;
  totalReviews: number;
  tags?: string[] | string;
  createdAt: string;
  updatedAt: string;
  __v?: number;
}

export interface Pagination {
  total?: number;
  pages?: number;
  totalPages?: number;
  totalReviews?: number;
  currentPage?: number;
  hasNext?: boolean;
  hasPrev?: boolean;
  count?: number;
}

export interface ProductsData {
  products: Product[];
  pagination: Pagination;
}

// Review interfaces
export interface ReviewUser {
  id: string;
  name: string;
}

export interface ReviewImage {
  url: string;
  alt?: string;
}

export interface Review {
  id: string;
  user: ReviewUser;
  rating: number;
  title?: string;
  comment: string;
  images?: ReviewImage[];
  isVerifiedPurchase: boolean;
  helpfulCount: number;
  isApproved: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface ReviewSummary {
  averageRating: number;
  totalReviews: number;
  ratingDistribution: {
    '5': number;
    '4': number;
    '3': number;
    '2': number;
    '1': number;
  };
}

export interface PaginatedReviews {
  reviews: Review[];
  pagination: Pagination;
}

export interface ReviewProduct {
  id: string;
  name: string;
  image: ProductImage | null;
}

export interface UserReview {
  id: string;
  product: ReviewProduct | null;
  rating: number;
  title?: string;
  comment: string;
  images?: ReviewImage[];
  isVerifiedPurchase: boolean;
  isApproved: boolean;
  helpfulCount: number;
  createdAt: string;
}

export interface PaginatedUserReviews {
  reviews: UserReview[];
  pagination: Pagination;
  count: number;
}

// User profile interfaces
export interface Address {
  fullName: string;
  phone: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  isDefault: boolean;
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: string;
  addresses: Address[];
  walletBalance?: number;
  createdAt?: string;
  updatedAt?: string;
}

// Return Request interfaces
export interface ReturnRequestItem {
  product: {
    _id: string;
    name: string;
    images: ProductImage[];
    price: number;
  };
  quantity: number;
  reason: string;
  condition: string;
}

export interface ReturnRequestImage {
  url: string;
  description?: string;
}

export interface ReturnRequestVideo {
  url: string;
  description?: string;
}

export interface ReturnRequestTimeline {
  status: string;
  note?: string;
  timestamp: string;
  updatedBy?: string;
}

export interface ReturnRequest {
  _id: string;
  order: {
    _id: string;
    createdAt: string;
  };
  user: string;
  items: ReturnRequestItem[];
  type: 'return' | 'exchange';
  status: 'pending' | 'approved' | 'rejected' | 'item_received' | 'completed' | 'cancelled';
  images?: ReturnRequestImage[];
  video?: ReturnRequestVideo;
  refundMethod: 'store_credit' | 'original_payment';
  refundAmount?: number;
  replacementOrder?: string;
  adminNotes?: string;
  rejectionReason?: string;
  timeline: ReturnRequestTimeline[];
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedReturnRequests {
  requests: ReturnRequest[];
  pagination: Pagination;
  count: number;
}

export interface OrderItem {
  product: {
    _id: string;
    name: string;
    images: ProductImage[];
  };
  quantity: number;
  price: number;
  name: string;
  image: string;
}

export interface Order {
  _id: string;
  user: string;
  items: OrderItem[];
  shippingAddress: {
    fullName: string;
    phone: string;
    addressLine1: string;
    addressLine2?: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
  payment: string;
  subtotal: number;
  shippingCost: number;
  tax: number;
  discount: number;
  totalAmount: number;
  status: 'pending' | 'confirmed' | 'processing' | 'shipped' | 'delivered' | 'cancelled' | 'refunded';
  trackingNumber?: string;
  estimatedDelivery?: string;
  deliveredAt?: string;
  cancelledAt?: string;
  cancellationReason?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedOrders {
  orders: Order[];
  pagination: Pagination;
  count: number;
}

export interface CardDetails {
  brand: string;
  last4: string;
  expiryMonth: number;
  expiryYear: number;
}

export interface PaymentMethod {
  id: string;
  paymentMethod: string;
  paymentGateway: string;
  card?: CardDetails;
  createdAt: string;
}

export interface PaymentMethodsData {
  paymentMethods: PaymentMethod[];
  count: number;
}

/**
 * Returns the canonical slug-based URL for a product page, or `null` if the
 * product has no slug (pre-migration doc).  Components should skip rendering
 * the link entirely when this returns `null` — dead `href="#"` links are bad
 * for accessibility and confuse crawlers.
 *
 * ⚠️  Do NOT fall back to `_id` here — that would expose ObjectId URLs and create
 * duplicate-content issues. The backend issues a 301 redirect for any /:id hit.
 *
 * Usage:
 *   `const url = productUrl(product);  if (!url) return null;`
 *   `const url = productUrl(product, '/products'); // guaranteed string`
 */
export function productUrl(product: { slug?: string | null; _id?: string; id?: string | number }, fallback: string): string;
export function productUrl(product: { slug?: string | null; _id?: string; id?: string | number }): string | null;
export function productUrl(
  product: { slug?: string | null; _id?: string; id?: string | number },
  fallback?: string
): string | null {
  if (product.slug) {
    // Only reject clearly corrupted slugs (starting with - or containing %20)
    const isCorrupted = product.slug.startsWith('-') || 
                        product.slug.includes('%20') || 
                        product.slug.trim() === '';
    
    if (!isCorrupted) {
      return `/products/${product.slug}`;
    }
    
    // Log warning for corrupted slugs
    console.warn(`[productUrl] Corrupted slug detected: "${product.slug}" for product ${product._id || product.id}`);
  }
  
  return fallback ?? null;
}