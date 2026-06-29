/**
 * PostHog e-commerce analytics helpers (ADR-005).
 *
 * Thin, safe wrappers around posthog-js. Every call no-ops when PostHog isn't configured
 * (no NEXT_PUBLIC_POSTHOG_KEY) or hasn't loaded, so callers never need to guard.
 *
 * Event names follow PostHog's e-commerce conventions so the funnel works out of the box:
 *   product_view → add_to_cart → begin_checkout → checkout_step → purchase
 * Plus the side funnels: search, wishlist, sign_up, and checkout_abandoned (drop-off).
 */
import posthog from 'posthog-js';

const ready = () => typeof window !== 'undefined' && !!process.env.NEXT_PUBLIC_POSTHOG_KEY && posthog.__loaded;

export const capture = (event: string, props?: Record<string, unknown>) => {
  if (!ready()) return;
  posthog.capture(event, props);
};

export interface ProductEventInput {
  id: string;
  name: string;
  price?: number;
  brand?: string;
  category?: string;
  quantity?: number;
}

export const trackProductView = (p: ProductEventInput) =>
  capture('product_view', {
    product_id: p.id, product_name: p.name, price: p.price, brand: p.brand, category: p.category,
  });

export const trackAddToCart = (p: ProductEventInput) =>
  capture('add_to_cart', {
    product_id: p.id, product_name: p.name, price: p.price, quantity: p.quantity ?? 1,
  });

export const trackRemoveFromCart = (p: ProductEventInput) =>
  capture('remove_from_cart', {
    product_id: p.id, product_name: p.name, price: p.price, quantity: p.quantity ?? 1,
  });

/** Cart page / cart step opened. */
export const trackViewCart = (input: { value: number; itemCount: number; currency?: string }) =>
  capture('view_cart', {
    value: input.value, item_count: input.itemCount, currency: input.currency ?? 'INR',
  });

export const trackSearch = (query: string, resultCount?: number) =>
  capture('search', { query, result_count: resultCount });

/** A product listing was viewed (browse funnel). */
export const trackViewItemList = (input: {
  listType: 'all' | 'search' | 'category';
  listName?: string;
  itemCount: number;
}) =>
  capture('view_item_list', {
    list_type: input.listType, list_name: input.listName, item_count: input.itemCount,
  });

export const trackAddToWishlist = (p: { id: string; name?: string; price?: number }) =>
  capture('add_to_wishlist', { product_id: p.id, product_name: p.name, price: p.price });

export const trackRemoveFromWishlist = (p: { id: string }) =>
  capture('remove_from_wishlist', { product_id: p.id });

/** New account created (distinct from login). */
export const trackSignUp = (method: string = 'email') =>
  capture('sign_up', { method });

/** Existing user logged in. Lets funnels compare logged-in vs guest behaviour. */
export const trackLogin = (method: string = 'email') =>
  capture('login', { method });

export type CheckoutStep = 'cart' | 'address' | 'payment' | 'review' | 'confirmation';

/** Progress through a checkout step — powers step-by-step drop-off analysis. */
export const trackCheckoutStep = (input: { step: CheckoutStep; value: number; itemCount: number }) =>
  capture('checkout_step', { step: input.step, value: input.value, item_count: input.itemCount });

/** Payment method chosen at checkout. */
export const trackAddPaymentInfo = (input: { method: string; value: number }) =>
  capture('add_payment_info', { payment_method: input.method, value: input.value });

/** Left checkout without completing the purchase (drop-off). */
export const trackCheckoutAbandoned = (input: { lastStep: CheckoutStep; value: number; itemCount: number }) =>
  capture('checkout_abandoned', {
    last_step: input.lastStep, value: input.value, item_count: input.itemCount,
  });

export const trackBeginCheckout = (input: { value: number; itemCount: number; currency?: string }) =>
  capture('begin_checkout', {
    value: input.value, item_count: input.itemCount, currency: input.currency ?? 'INR',
  });

export const trackPurchase = (input: {
  orderId: string;
  value: number;
  itemCount?: number;
  currency?: string;
}) =>
  capture('purchase', {
    order_id: input.orderId, value: input.value, item_count: input.itemCount, currency: input.currency ?? 'INR',
  });

/** Tie events to a user after login. */
export const identifyUser = (user: { id: string; email?: string; name?: string }) => {
  if (!ready()) return;
  posthog.identify(user.id, { email: user.email, name: user.name });
};

/** Clear identity on logout. */
export const resetAnalytics = () => {
  if (!ready()) return;
  posthog.reset();
};
