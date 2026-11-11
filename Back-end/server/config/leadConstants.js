/**
 * Shared Sales-CRM enums. Kept out of the model file so controllers/routes/
 * services can import them without tripping the repository-layer lint rule
 * (no direct `models/` imports outside repositories/).
 */

export const SOURCE_TYPES = [
  'consultation',
  'payment_pending',    // Order created, awaiting payment ("left at checkout")
  'payment_failed',     // Order payment attempt failed
  'payment_cancelled',  // Customer cancelled the payment popup (vs admin order-cancel)
  'order_cancelled',    // A placed order was cancelled (admin or customer) → re-engagement target
  'cart_abandoned',     // Cart with items, no order placed
  'backorder_waitlist', // Joined the waiting list for an on-backorder product → warm prospect
  'dormant_user',       // Registered account, never placed a paid order
];

export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'won', 'lost'];

// Team leads sheet: a lead someone is following up on with nothing logged for this
// many days gets a "No update for N days" tag. It is NOT released automatically —
// the GTM head decides (taking a lead away mid-deal surprises people).
export const LEAD_QUIET_DAYS = 7;

export const TERMINAL_LEAD_STATUSES = ['won', 'lost'];

/*
  Follow-up statuses on the GTM leads sheet (/team/leads). Each time someone
  follows up a lead they record one of these, with an optional note ('other'
  needs one). Saved as a `follow_up` history line; the newest one is also kept on
  the lead (followUpStatus) for the badge and the filter.

  What each does to the lead's own status (teamLeadService.recordFollowUp):
    responded, whatsapp, other  → new becomes contacted
    converted                   → moves forward to qualified, stays OPEN: a lead
                                  is marked won only by a real paid order
                                  (leadSyncService), never by hand
    not_interested              → closes it as lost
    no_response                 → no change
*/
export const FOLLOW_UP_STATUSES = Object.freeze({
  responded: 'Responded',
  whatsapp: 'WhatsApp',
  converted: 'Converted',
  no_response: 'No response',
  not_interested: 'Not interested',
  other: 'Others',
});
export const FOLLOW_UP_STATUS_KEYS = Object.keys(FOLLOW_UP_STATUSES);
export const FOLLOW_UP_NOTE_MAX = 500;

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
  order_cancelled: 8,  // strongest re-engagement signal — they placed AND cancelled a real order
  payment_failed: 7,
  payment_cancelled: 6,
  payment_pending: 5,
  consultation: 4,
  backorder_waitlist: 3, // named a specific product they want — warm, on par with a consultation
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
  payment_pending: 34,     // reached checkout, never paid ("left at checkout")
  consultation: 26,        // asked for advice — warm, needs nurture
  backorder_waitlist: 24,  // wants a specific out-of-stock product — warm buy intent
  cart_abandoned: 16,      // items in cart, never checked out
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

/*
  Meta leads: next follow-up deadlines (services/metaLeadDeadlineService.js).
  Deadlines and reminders live inside office hours, India time: a follow-up set
  for 9 pm moves to 10 am the next working day, and nobody is pinged at night.
*/
export const META_LEAD_OFFICE = Object.freeze({
  startHour: 10,
  endHour: 19,
  // 0 = Sunday … 6 = Saturday
  days: Object.freeze([1, 2, 3, 4, 5, 6]),
});
export const META_LEAD_REMINDER_MIN = 10; // pop-up this long before a deadline
export const META_LEAD_ESCALATE_HEAD_MIN = 2 * 60; // overdue this long → GTM head
export const META_LEAD_ESCALATE_MANAGERS_MIN = 24 * 60; // overdue this long → admin + Marketing head
export const META_LEAD_FIRST_FOLLOW_UP_MIN = 60; // office minutes after taking a lead
export const META_LEAD_NEXT_MAX_DAYS = 60; // furthest a next follow-up may be set
export const META_LEAD_REASON_MIN = 5; // characters: "ok" is not a reason
export const META_LEAD_REASON_MAX = 500;
// These close the lead: no next follow-up is asked for.
export const FOLLOW_UP_CLOSING = Object.freeze(['converted', 'not_interested']);
