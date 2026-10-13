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

export interface QuoteLine {
  name: string;
  quantity: number;
  lineTotal: number;
}

export interface CheckoutQuote {
  subtotal: number;
  shipping: number;
  tax: number;
  discount: number;
  total: number;
  lines: QuoteLine[];
  currency: string;
}

/**
 * The authoritative price of this cart, recomputed server-side. This is what
 * the customer is charged — the app only displays it.
 */
export async function fetchQuote(body: Record<string, unknown> = {}): Promise<CheckoutQuote> {
  const res = await api.post<{ quote?: Partial<CheckoutQuote>; [k: string]: unknown }>('/checkout/quote', body);
  const q = (res.quote ?? res) as Partial<CheckoutQuote>;
  return {
    subtotal: q.subtotal ?? 0,
    shipping: q.shipping ?? 0,
    tax: q.tax ?? 0,
    discount: q.discount ?? 0,
    total: q.total ?? 0,
    lines: q.lines ?? [],
    currency: q.currency ?? 'INR',
  };
}
