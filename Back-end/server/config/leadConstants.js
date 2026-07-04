/**
 * Shared Sales-CRM enums. Kept out of the model file so controllers/routes/
 * services can import them without tripping the repository-layer lint rule
 * (no direct `models/` imports outside repositories/).
 */

export const SOURCE_TYPES = [
  'consultation',
  'payment_pending', // Order created, awaiting payment ("left at checkout")
  'payment_failed',  // Order payment attempt failed
  'cart_abandoned',  // Cart with items, no order placed
  'dormant_user',    // Registered account, never placed a paid order
];

export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'won', 'lost'];

// Badge priority when a person has several signals — highest wins `primarySource`.
export const SOURCE_PRIORITY = {
  payment_failed: 5,
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
