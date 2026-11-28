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
import type { PostHog } from 'posthog-js';
import { readyPostHog } from './posthogLoader';

const enabled = () => typeof window !== 'undefined' && !!process.env.NEXT_PUBLIC_POSTHOG_KEY;

/** PostHog starts once the page has settled; anything earlier waits here, in order. */
const MAX_WAITING = 50;
const waiting: Array<(ph: PostHog) => void> = [];

/** Runs now if PostHog is up, else queues (bounded) until PostHogProvider starts it. */
export const whenAnalyticsReady = (run: (ph: PostHog) => void) => {
  if (!enabled()) return;
  const ph = readyPostHog();
  if (ph) run(ph);
  else if (waiting.length < MAX_WAITING) waiting.push(run);
};

/** PostHog's `loaded` hook passes its client; callers without one get the ready client. */
export const flushWaitingAnalytics = (client?: PostHog) => {
  const ph = client ?? readyPostHog();
  if (!ph) return;
  while (waiting.length) waiting.shift()!(ph);
};

export const capture = (event: string, props?: Record<string, unknown>) => {
  whenAnalyticsReady((ph) => ph.capture(event, props));
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

/*
  Razorpay window funnel: opened → (paid | dismissed | failed). Before these, a shopper
  who reached "Place Order" and then vanished was invisible — the audit could not tell
  a closed window from a declined card. No PII: ids, amounts and Razorpay's error
  codes only (never the error description, card or contact details).
*/
export interface RazorpayEventBase { orderId: string; amount: number; method?: string | null }

export const trackRazorpayOpened = (input: RazorpayEventBase) =>
  capture('razorpay_opened', {
    order_id: input.orderId, value: input.amount, currency: 'INR', start_method: input.method ?? null,
  });

export const trackRazorpayDismissed = (input: RazorpayEventBase) =>
  capture('razorpay_dismissed', {
    order_id: input.orderId, value: input.amount, currency: 'INR', start_method: input.method ?? null,
  });

export const trackPaymentFailed = (input: RazorpayEventBase & {
  errorCode?: string | null; errorReason?: string | null; errorSource?: string | null; errorStep?: string | null;
}) =>
  capture('payment_failed', {
    order_id: input.orderId,
    value: input.amount,
    currency: 'INR',
    method: input.method ?? null,
    error_code: input.errorCode ?? null,
    error_reason: input.errorReason ?? null,
    error_source: input.errorSource ?? null,
    error_step: input.errorStep ?? null,
  });

export const trackBeginCheckout = (input: { value: number; itemCount: number; currency?: string }) =>
  capture('begin_checkout', {
    value: input.value, item_count: input.itemCount, currency: input.currency ?? 'INR',
  });

/**
 * A completed purchase.
 *
 * `couponCode` / `campaignSlug` / `discount` carry the promotional attribution, and
 * exist so a funnel can separate "bought while a campaign was running" from "bought
 * USING the campaign" — without them a scan→purchase funnel counts every purchase by
 * anyone who ever landed on the offer page, which flatters the campaign rather than
 * measuring it.
 *
 * The keys are always emitted, `null` when nothing applied, so the event has one stable
 * shape. A property that is sometimes absent and sometimes null is the kind of thing
 * that makes a saved funnel quietly stop matching.
 *
 * Display/attribution only. These figures are echoed from the server-computed quote and
 * are never what the customer is charged — the order total is recomputed server-side at
 * creation. A wrong value here mis-reports a chart; it cannot mis-bill anyone.
 */
export const trackPurchase = (input: {
  orderId: string;
  value: number;
  itemCount?: number;
  currency?: string;
  couponCode?: string | null;
  campaignSlug?: string | null;
  discount?: number | null;
}) =>
  capture('purchase', {
    order_id: input.orderId, value: input.value, item_count: input.itemCount, currency: input.currency ?? 'INR',
    coupon_code: input.couponCode ?? null,
    campaign_slug: input.campaignSlug ?? null,
    discount: input.discount ?? 0,
  });

/**
 * A campaign offer page was viewed — the QR-scan signal.
 *
 * Keyed on the campaign SLUG rather than the URL. `/festive` is a permanent route whose
 * printed QR cannot be reissued, so the next campaign will reuse it; a funnel filtered on
 * the path would silently merge two campaigns' traffic, while one filtered on the slug
 * stays correct for ever.
 */
export const trackCampaignOfferViewed = (input: {
  slug: string;
  /** Was the campaign still running when the card was scanned? */
  offerLive: boolean;
  /** Could THIS visitor actually redeem it (signed in, verified, not already used)? */
  eligible?: boolean | null;
}) =>
  capture('campaign_offer_viewed', {
    campaign_slug: input.slug,
    offer_live: input.offerLive,
    eligible: input.eligible ?? null,
  });

/** Tie events to a user after login. */
export const identifyUser = (user: { id: string; email?: string; name?: string }) => {
  whenAnalyticsReady((ph) => ph.identify(user.id, { email: user.email, name: user.name }));
};

/** Clear identity on logout. */
export const resetAnalytics = () => {
  whenAnalyticsReady((ph) => ph.reset());
};
