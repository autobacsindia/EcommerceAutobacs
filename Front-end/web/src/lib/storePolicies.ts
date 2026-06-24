/**
 * Store-wide trust / policy statements shown on product pages.
 *
 * Single source of truth — edit here to update everywhere. ONLY include claims
 * that are true for every product on autobacsindia.com. The catalog (migrated
 * from WooCommerce) has no per-product warranty / return / shipping data, so we
 * never fabricate those promises. Enable a badge below only once it is confirmed
 * accurate for the whole store.
 */

export type TrustIcon = 'CreditCard' | 'Shield' | 'Truck' | 'RotateCcw';

export interface TrustBadge {
  icon: TrustIcon;
  label: string;
}

// Verified, site-wide statements. Add { icon: 'RotateCcw', label: '7-Day Returns' }
// or a warranty badge here once those policies are confirmed for all products.
export const TRUST_BADGES: TrustBadge[] = [
  { icon: 'Shield', label: 'Genuine Products' },
  { icon: 'CreditCard', label: 'Secure Checkout' },
  { icon: 'Truck', label: 'Shipping calculated at checkout' },
];
