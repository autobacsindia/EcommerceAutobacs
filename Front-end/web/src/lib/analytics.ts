/**
 * PostHog e-commerce analytics helpers (ADR-005).
 *
 * Thin, safe wrappers around posthog-js. Every call no-ops when PostHog isn't configured
 * (no NEXT_PUBLIC_POSTHOG_KEY) or hasn't loaded, so callers never need to guard.
 *
 * Event names follow PostHog's e-commerce conventions so the funnel works out of the box:
 *   product_view → add_to_cart → begin_checkout → purchase
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
