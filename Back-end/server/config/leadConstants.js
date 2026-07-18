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

// Active (workable) statuses — a live lead a rep can still move. The pool/nurture
// counts, the re-score sweep, and the stale-follow-up sweep all operate on these;
// won/lost are closed and excluded. Single source of truth for the triplet.
export const OPEN_LEAD_STATUSES = ['new', 'contacted', 'qualified'];

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

// Intent contribution (of the 0–100 leadScore) for the strongest source a person
// carries. Absolute band 0–45 — mirrors SOURCE_PRIORITY's ordering but tuned as a
// hotness weight: a stalled *payment* is far more sales-ready than an abandoned
// cart, which beats a passive never-purchased signup. See utils/leadScore.js.
export const SOURCE_INTENT_SCORE = {
  order_cancelled: 45,   // placed a real order then cancelled — hottest re-engagement
  payment_failed: 42,    // tried to pay, card/bank declined — very live
  payment_cancelled: 38, // dismissed the payment popup
  payment_pending: 34,   // reached checkout, never paid ("left at checkout")
  consultation: 26,      // asked for advice — warm, needs nurture
  cart_abandoned: 16,    // items in cart, never checked out
  dormant_user: 4,       // passive: registered, never bought
};

// The one source that is a passive marketing/nurture segment, not a rep worklist
// item. Excluded from the default active pipeline view and surfaced under its own
// "Nurture" bucket. See leadController buildListQuery + docs (never resurrects a
// closed cycle either — REOPEN_SOURCE_TYPES).
export const NURTURE_SOURCE = 'dormant_user';

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
