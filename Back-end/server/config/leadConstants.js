/**
 * Shared Sales-CRM enums. Kept out of the model file so controllers/routes/
 * services can import them without tripping the repository-layer lint rule
 * (no direct `models/` imports outside repositories/).
 */

export const SOURCE_TYPES = [
  'consultation',
  'payment_pending',   // Order created, awaiting payment ("left at checkout")
  'payment_failed',    // Order payment attempt failed
  'payment_cancelled', // Customer cancelled the payment popup (vs admin order-cancel)
  'order_cancelled',   // A placed order was cancelled (admin or customer) → re-engagement target
  'cart_abandoned',    // Cart with items, no order placed
  'dormant_user',      // Registered account, never placed a paid order
];

export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'won', 'lost'];

export const TERMINAL_LEAD_STATUSES = ['won', 'lost'];

// Source types that represent a fresh, rep-workable action BY THE PERSON. When a
// new one of these lands on a CLOSED lead (won/lost), it starts a new sales cycle
// (reopen-with-history). `dormant_user` is deliberately EXCLUDED: it's a passive,
// time-based sweep signal and must never resurrect a rep's closed decision. See
// ADR-006. Used only by leadSyncService's reopen guard.
export const REOPEN_SOURCE_TYPES = SOURCE_TYPES.filter((t) => t !== 'dormant_user');

// Badge priority when a person has several signals — highest wins `primarySource`.
export const SOURCE_PRIORITY = {
  order_cancelled: 7,  // strongest re-engagement signal — they placed AND cancelled a real order
  payment_failed: 6,
  payment_cancelled: 5,
  payment_pending: 4,
  consultation: 3,
  cart_abandoned: 2,
  dormant_user: 1,
};

// Lead status → Consultation status (mirror out).
export const LEAD_TO_CONSULTATION = {
  new: 'new',
  contacted: 'contacted',
  qualified: 'contacted',
  won: 'completed',
  lost: 'cancelled',
};

// Consultation status → Lead status (mirror in).
export const CONSULTATION_TO_LEAD = {
  new: 'new',
  contacted: 'contacted',
  completed: 'won',
  cancelled: 'lost',
};
