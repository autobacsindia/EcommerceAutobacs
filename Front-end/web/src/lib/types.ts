// Define types for our data models

import type { StockStatus } from './stock';
export type { StockStatus } from './stock';

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
  saleEndsAt?: string | null;
  category?: Category | string;
  categories?: Category[];
  brand?: string;
  images: ProductImage[] | string;
  stock: StockStatus;
  sku?: string;
  specifications?: ProductSpecification[] | string;
  features?: string[] | string;
  isActive: boolean;
  isFeatured: boolean;
  averageRating: number;
  totalReviews: number;
  tags?: string[] | string;
  // Variable-product fields (simple products omit them). Cards show a "From"
  // price range and route to the PDP to pick a model.
  productType?: 'simple' | 'variable' | 'grouped';
  priceMin?: number;
  priceMax?: number;
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
  createdAt?: string;
  updatedAt?: string;
}

// Return Request interfaces
export interface ReturnRequestItem {
  product: {
    _id: string;
    name: string;
    images?: ProductImage[];
    price?: number;
  };
  quantity: number;
  reason: string;
  unitPrice?: number;
}

/** A signed, viewable copy of a private return asset (admin detail response). */
export interface ReturnSignedAsset {
  url: string;
  bytes?: number;
  resourceType?: 'video' | 'image' | 'raw';
}

export interface ReturnRequestTimeline {
  status: string;
  note?: string;
  timestamp: string;
  updatedBy?: string;
}

export type ReturnStatus =
  | 'pending' | 'approved' | 'courier_booked' | 'received' | 'refunded' | 'rejected' | 'cancelled';

export interface ReturnRefund {
  /** What the customer actually PAID for the returned lines — the refundable base. */
  productValue: number;
  /** Gross list value of those lines, and their share of the order-level discount. */
  listValue?: number;
  discountShare?: number;
  shippingDeduction?: number;
  restockingDeduction?: number;
  finalAmount?: number;
  method?: 'original_payment';
  razorpayRefundId?: string;
  status?: 'pending' | 'processing' | 'completed' | 'failed';
  initiatedAt?: string;
  failureReason?: string;
}

/** GET /returns/admin/:id/refund-preview — the operator's decision surface. */
export interface ReturnRefundPreview {
  productValue: number;
  listValue: number;
  discountShare: number;
  couponCode: string | null;
  /** Gateway headroom: Razorpay rejects anything above `maxRefundable` outright. */
  orderTotal: number;
  alreadyRefunded: number;
  maxRefundable: number;
  suggestedRestocking: number;
  shippingDeductionDefault: number | null;
  /** e.g. "Debit Card EMI · ICICI" — present only when the order was paid on EMI. */
  paidBy: string | null;
  /**
   * True when the instrument accepts full refunds only (debit-card EMI: the issuer
   * holds a loan against the whole capture and cannot unwind part of it). The server
   * enforces this with a 422; the UI mirrors it so the operator sees it before typing
   * an amount the gateway would reject.
   */
  fullRefundOnly: boolean;
  note: string;
}

export interface ReturnRequest {
  _id: string;
  order: { _id: string; orderNumber?: string; totalAmount?: number; createdAt?: string };
  user: string | { _id?: string; name?: string; email?: string };
  items: ReturnRequestItem[];
  type: 'return';
  status: ReturnStatus;
  problemDescription?: string;
  // On the admin DETAIL response these are signed { url } objects; on the list
  // response the private refs are omitted.
  video?: ReturnSignedAsset | null;
  proofOfPurchase?: ReturnSignedAsset | null;
  images?: ReturnSignedAsset[];
  shippingBorneBy?: 'roavion' | 'customer';
  /** `bookedAt` is the original handover (preserved across a correction); `correctedAt` is the last edit. */
  courier?: { provider?: string; trackingNumber?: string; bookedAt?: string; correctedAt?: string };
  inspection?: { passed?: boolean | null; notes?: string; at?: string };
  refund?: ReturnRefund;
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

/**
 * Safe projection of a Payment row, returned by `GET /orders/:id`. The raw Razorpay
 * entity (MDR fee/tax, card id, acquirer data) is stripped server-side and is not
 * available here by design.
 */
export interface OrderPaymentSummary {
  _id: string;
  paymentMethod: string;
  paymentGateway: string;
  methodDetails?: {
    rawMethod?: string;
    cardNetwork?: string;
    cardType?: string;
    cardIssuer?: string;
    cardLast4?: string;
    emi?: {
      kind?: 'credit_card' | 'debit_card' | 'cardless' | 'unknown';
      issuer?: string;
      months?: number;
      ratePercent?: number;
    };
  };
  /** Pre-rendered by the backend, e.g. "Credit Card EMI · HDFC · 6 months @ 14%". */
  emiPlanLabel?: string;
  status: string;
  amount: number;
  currency?: string;
  refundAmount?: number;
  refundedAt?: string;
  /** `pay_...` — appears on the customer's card statement; their bank-dispute reference. */
  gatewayPaymentId?: string;
  createdAt?: string;
}

export interface Order {
  _id: string;
  orderNumber?: string;
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
  /**
   * Order detail (`GET /orders/:id`) returns a projected summary; list endpoints
   * still return the bare id. The raw gateway entity is never sent.
   */
  payment: string | OrderPaymentSummary | null;
  subtotal: number;
  shippingCost: number;
  tax: number;
  discount: number;
  totalAmount: number;
  // Fulfillment axis (Phase 2). Legacy values kept in the union so historical
  // orders + existing comparisons stay valid; payment lives in paymentStatus.
  status: 'awaiting_payment' | 'processing' | 'shipped' | 'delivered' | 'returned' | 'cancelled' | 'pending' | 'confirmed' | 'refunded' | 'failed';
  paymentStatus?: 'pending' | 'paid' | 'failed' | 'refunded';
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