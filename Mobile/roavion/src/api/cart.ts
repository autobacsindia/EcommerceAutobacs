/**
 * Cart and checkout.
 *
 * MONEY RULE, same as the website: the app never calculates or sends a price.
 * It sends product ids and quantities; the server returns every amount. A
 * tampered app can therefore change what it asks for, never what it pays.
 */
import { api } from './client';
import type { ApiImage } from './catalogue';

export interface CartLine {
  productId: string;
  variantId: string | null;
  name: string;
  slug: string;
  image: string;
  /** Unit price, as returned by the server. */
  price: number;
  quantity: number;
  stock: 'in' | 'low' | 'out';
  variantLabel?: string | null;
}

export interface Cart {
  items: CartLine[];
  totalItems: number;
  /** Server-computed subtotal. The real total comes from the checkout quote. */
  totalPrice: number;
  couponCode: string | null;
}

interface RawCartItem {
  product?: { _id?: string; name?: string; slug?: string; images?: ApiImage[]; stock?: string; price?: number } | string;
  productId?: string;
  variantId?: string | null;
  variantLabel?: string | null;
  name?: string;
  price?: number;
  quantity?: number;
  image?: string;
}

const firstImage = (images?: ApiImage[]) => (images?.find((i) => i.isPrimary) ?? images?.[0])?.url ?? '';

function toLine(raw: RawCartItem): CartLine {
  const product = typeof raw.product === 'object' && raw.product ? raw.product : undefined;
  return {
    productId: product?._id ?? raw.productId ?? (typeof raw.product === 'string' ? raw.product : ''),
    variantId: raw.variantId ?? null,
    name: raw.name ?? product?.name ?? 'Item',
    slug: product?.slug ?? '',
    image: raw.image || firstImage(product?.images),
    price: raw.price ?? product?.price ?? 0,
    quantity: raw.quantity ?? 1,
    stock: (product?.stock as CartLine['stock']) ?? 'in',
    variantLabel: raw.variantLabel ?? null,
  };
}

const toCart = (raw: {
  items?: RawCartItem[];
  totalItems?: number;
  totalPrice?: number;
  couponCode?: string | null;
}): Cart => ({
  items: (raw.items ?? []).map(toLine),
  totalItems: raw.totalItems ?? 0,
  totalPrice: raw.totalPrice ?? 0,
  couponCode: raw.couponCode ?? null,
});

export async function fetchCart(signal?: AbortSignal): Promise<Cart> {
  const res = await api.get<{ cart?: Parameters<typeof toCart>[0] }>('/cart', signal);
  return toCart(res.cart ?? {});
}

export async function addToCart(productId: string, quantity = 1, variantId?: string | null): Promise<Cart> {
  const res = await api.post<{ cart?: Parameters<typeof toCart>[0] }>('/cart/add', {
    productId,
    quantity,
    ...(variantId ? { variantId } : {}),
  });
  return toCart(res.cart ?? {});
}

export async function updateQuantity(productId: string, quantity: number, variantId?: string | null): Promise<Cart> {
  const res = await api.put<{ cart?: Parameters<typeof toCart>[0] }>(`/cart/update/${productId}`, {
    quantity,
    ...(variantId ? { variantId } : {}),
  });
  return toCart(res.cart ?? {});
}

export async function removeFromCart(productId: string, variantId?: string | null): Promise<Cart> {
  const query = variantId ? `?variantId=${encodeURIComponent(variantId)}` : '';
  const res = await api.del<{ cart?: Parameters<typeof toCart>[0] }>(`/cart/remove/${productId}${query}`);
  return toCart(res.cart ?? {});
}

/** Hand a guest cart to the account that just signed in. */
export async function mergeGuestCart(): Promise<void> {
  await api.post('/cart/merge', {});
}

export interface CheckoutQuote {
  subtotal: number;
  /** What the coupon took off the goods. */
  couponDiscount: number;
  /** Every discount combined (coupon + loyalty points). */
  discount: number;
  shipping: number;
  freeShippingApplied: boolean;
  tax: number;
  total: number;
  /** The code the server actually honoured, or null. */
  appliedCoupon: string | null;
  /** Why a requested coupon did NOT apply — shown to the customer verbatim. */
  couponError: string | null;
  /** Total saved against M.R.P. plus coupon, as the server adds it up. */
  savingsTotal: number;
  currency: string;
}

interface RawQuote {
  subtotal?: number;
  couponDiscount?: number;
  discount?: number;
  shippingCost?: number;
  freeShippingApplied?: boolean;
  tax?: number;
  totalAmount?: number;
  appliedCoupon?: string | { code?: string } | null;
  couponError?: string | null;
  savings?: { total?: number } | null;
  currency?: string;
}

/*
  Field names are the SERVER's (pricingService.computeQuote).

  An earlier version read `shipping` and `total`, which the server has never
  sent — it sends `shippingCost` and `totalAmount`. The function was unused, so
  nothing showed ₹0, but the first screen to call it would have told a customer
  their order cost nothing. Mapped explicitly here so a rename on the server
  shows up as one obvious line, not a silent zero.
*/
const toQuote = (q: RawQuote): CheckoutQuote => ({
  subtotal: q.subtotal ?? 0,
  couponDiscount: q.couponDiscount ?? 0,
  discount: q.discount ?? 0,
  shipping: q.shippingCost ?? 0,
  freeShippingApplied: !!q.freeShippingApplied,
  tax: q.tax ?? 0,
  total: q.totalAmount ?? 0,
  appliedCoupon:
    typeof q.appliedCoupon === 'string' ? q.appliedCoupon : (q.appliedCoupon?.code ?? null),
  couponError: q.couponError ?? null,
  savingsTotal: q.savings?.total ?? 0,
  currency: q.currency ?? 'INR',
});

export interface QuoteItem {
  product: string;
  quantity: number;
  variantId?: string | null;
}

/**
 * The authoritative price of this cart, recomputed server-side. This is what
 * the customer is charged — the app only displays it.
 */
export async function fetchQuote(
  body: { items: QuoteItem[]; couponCode?: string | null },
  signal?: AbortSignal,
): Promise<CheckoutQuote> {
  const res = await api.post<{ quote?: RawQuote }>('/checkout/quote', body, signal);
  return toQuote(res.quote ?? {});
}

/**
 * Apply a coupon to the cart. The server validates it against the real cart
 * (minimum spend, expiry, first-order-only, per-customer limits) and stores
 * only the CODE — never an amount — so nothing here can change a price.
 * A rejection throws an ApiError carrying the server's own reason.
 */
export async function applyCoupon(code: string): Promise<{ message: string; discountApplied: boolean }> {
  const res = await api.put<{ message?: string; discountApplied?: boolean }>('/cart/coupon', { code });
  return { message: res.message ?? `${code} applied`, discountApplied: res.discountApplied !== false };
}

export async function removeCoupon(): Promise<void> {
  await api.del('/cart/coupon');
}
