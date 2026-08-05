/**
 * Support / ticketing constants — single source of truth.
 *
 * Mirrors the pattern of config/returnPolicy.js: every status string, channel
 * name and SLA number lives here and is imported by the model enums, the
 * service state machine, the validators and the admin UI, so the vocabulary can
 * never drift between a Mongoose enum and a hand-written string in a controller.
 *
 * The frontend mirrors the customer-visible subset in
 * Front-end/web/src/lib/supportConstants.ts — update both together.
 */

/**
 * Ticket lifecycle.
 *
 *   new              → created, nobody has looked at it yet
 *   open             → an agent owns it and is working it
 *   pending_customer → we replied and are waiting on the customer
 *   on_hold          → blocked on something internal (warehouse, courier, vendor)
 *   resolved         → we believe it is done; a customer reply reopens it
 *   closed           → terminal; a customer reply spawns a follow-up ticket
 *
 * `resolved` vs `closed` matters for inbound email: replying to a resolved
 * ticket must reopen the SAME thread (the customer is still mid-conversation),
 * whereas replying to a long-closed one should not silently resurrect months-old
 * context. See REOPEN_WINDOW_DAYS.
 */
export const TICKET_STATUSES = Object.freeze([
  'new', 'open', 'pending_customer', 'on_hold', 'resolved', 'closed',
]);

/** Statuses that count as "needs someone to act" for inbox counts and SLA. */
export const OPEN_TICKET_STATUSES = Object.freeze(['new', 'open', 'on_hold']);

/** Terminal statuses — no SLA timer runs against these. */
export const TERMINAL_TICKET_STATUSES = Object.freeze(['resolved', 'closed']);

/**
 * Legal state transitions. Enforced in ticketService, never inline in a route,
 * so an admin cannot drag a ticket from `closed` straight back to `new` and
 * corrupt the first-response metrics.
 */
export const TICKET_TRANSITIONS = Object.freeze({
  new:              ['open', 'pending_customer', 'on_hold', 'resolved', 'closed'],
  open:             ['pending_customer', 'on_hold', 'resolved', 'closed'],
  pending_customer: ['open', 'on_hold', 'resolved', 'closed'],
  on_hold:          ['open', 'pending_customer', 'resolved', 'closed'],
  resolved:         ['open', 'closed'],
  closed:           ['open'],
});

/**
 * How a ticket entered the system. Drives routing, the icon in the admin inbox,
 * and whether replies go out by email at all (a `product_question` answer is
 * published on the PDP as well as emailed).
 */
export const TICKET_CHANNELS = Object.freeze([
  'email',            // inbound mail to support@ via the Postmark inbound stream
  'web_form',         // the /contact form
  'product_question', // a question asked on a PDP
  'review',           // follow-up on a submitted review
  'return',           // conversation attached to a ReturnRequest
  'admin',            // opened by an agent on the customer's behalf (phone/WhatsApp walk-in)
]);

export const TICKET_PRIORITIES = Object.freeze(['low', 'normal', 'high', 'urgent']);

/**
 * Message visibility. `internal` notes are agent-only and MUST never be
 * included in any customer-facing serializer or outbound email — the API layer
 * filters on this field, it is not merely a UI concern.
 */
export const MESSAGE_VISIBILITY = Object.freeze(['public', 'internal']);

export const MESSAGE_DIRECTIONS = Object.freeze(['inbound', 'outbound']);

/**
 * First-response SLA in BUSINESS hours, by priority. Business hours are
 * Mon–Sat 10:00–18:00 IST (mirrors the hours published on /contact); the clock
 * does not run on Sundays or overnight, so a Saturday-evening email is not
 * already breached by Monday morning.
 *
 * Computed with utils/datetime.js (Asia/Kolkata-pinned) — never with a bare
 * Date, which resolves to UTC on Railway and would breach every ticket ~5.5h
 * early.
 */
export const FIRST_RESPONSE_SLA_HOURS = Object.freeze({
  urgent: 2,
  high:   4,
  normal: 8,   // one full business day
  low:    24,
});

/** Resolution SLA in business hours, by priority. */
export const RESOLUTION_SLA_HOURS = Object.freeze({
  urgent: 8,
  high:   24,
  normal: 72,
  low:    120,
});

/** Published support hours, in IST. Keep in lockstep with the /contact page. */
export const BUSINESS_HOURS = Object.freeze({
  timezone: 'Asia/Kolkata',
  startHour: 10,          // 10:00 IST
  endHour: 18,            // 18:00 IST
  workingDays: Object.freeze([1, 2, 3, 4, 5, 6]), // Mon–Sat; 0 = Sunday is closed
});

/**
 * Full-day closures, as IST "YYYY-MM-DD" strings. The SLA clock does not run on
 * these days, so a ticket arriving the evening before Diwali is not already
 * breached when the team returns.
 *
 * Sourced from SUPPORT_HOLIDAYS (comma-separated) so the list can be updated in
 * the Railway dashboard without a deploy — a public holiday calendar is
 * operational data, not code. Malformed entries are dropped rather than
 * throwing, because a typo in an env var must never take the API down.
 */
export const SUPPORT_HOLIDAYS = Object.freeze(
  String(process.env.SUPPORT_HOLIDAYS || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s))
);

/**
 * A customer reply to a ticket resolved/closed within this many days reopens
 * that ticket. Older than this and we open a NEW ticket that references the old
 * one — otherwise a "thanks!" six months later resurrects dead context and
 * skews resolution-time metrics.
 */
export const REOPEN_WINDOW_DAYS = 14;

/**
 * Outbound loop breaker. If a single ticket has already sent this many emails
 * within LOOP_GUARD_WINDOW_MINUTES, further automatic sends are suppressed and
 * the ticket is flagged for a human.
 *
 * This is the defence against auto-responder ping-pong: their out-of-office
 * replies to our acknowledgement, which we treat as a customer reply, which
 * triggers another acknowledgement. Without a breaker that loop runs until
 * someone notices the Postmark bill.
 */
export const LOOP_GUARD_MAX_OUTBOUND = 10;
export const LOOP_GUARD_WINDOW_MINUTES = 60;

/**
 * SpamAssassin score (from the Postmark inbound payload's X-Spam-Score header)
 * at or above which inbound mail is filed as spam: no ticket, no acknowledgement,
 * no notification. Postmark's own threshold is 5.0; we match it.
 */
export const SPAM_SCORE_THRESHOLD = 5;

/** Ticket reference shown to customers and used in subject lines: ABI-1042. */
export const TICKET_PREFIX = 'ABI';

/** Named Counter series backing the ticket reference (models/Counter.js). */
export const TICKET_COUNTER_NAME = 'supportTicket';

/**
 * Attachment limits for inbound email and the web form. Anything outside the
 * allowlist is dropped and recorded on the message as a rejected attachment —
 * we never store an executable, and we never trust the sender's Content-Type
 * alone (it is attacker-controlled; the extension check runs too).
 */
export const ATTACHMENT_MAX_BYTES = 15 * 1024 * 1024; // 15 MB per file
export const ATTACHMENT_MAX_COUNT = 10;
export const ATTACHMENT_ALLOWED_MIME = Object.freeze([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic',
  'video/mp4', 'video/quicktime',
  'application/pdf',
  'text/plain',
]);
export const ATTACHMENT_ALLOWED_EXT = Object.freeze([
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic',
  '.mp4', '.mov', '.pdf', '.txt',
]);

/**
 * Format a ticket reference from its sequence number.
 * @param {number} seq
 * @returns {string} e.g. "ABI-1042"
 */
export const formatTicketRef = (seq) => `${TICKET_PREFIX}-${seq}`;

/**
 * Extract a ticket reference from an email subject line — the last-resort
 * threading fallback, used only when both the References header and the signed
 * reply-to token are missing.
 * @param {string} subject
 * @returns {string|null} e.g. "ABI-1042", or null when absent
 */
export const parseTicketRef = (subject = '') => {
  const m = String(subject).match(new RegExp(`\\b${TICKET_PREFIX}-(\\d+)\\b`, 'i'));
  return m ? `${TICKET_PREFIX}-${m[1]}` : null;
};

/**
 * Whether a status change is permitted.
 * @param {string} from
 * @param {string} to
 * @returns {boolean}
 */
export const canTransition = (from, to) =>
  from === to || Boolean(TICKET_TRANSITIONS[from]?.includes(to));

export default {
  TICKET_STATUSES,
  OPEN_TICKET_STATUSES,
  TERMINAL_TICKET_STATUSES,
  TICKET_TRANSITIONS,
  TICKET_CHANNELS,
  TICKET_PRIORITIES,
  MESSAGE_VISIBILITY,
  MESSAGE_DIRECTIONS,
  FIRST_RESPONSE_SLA_HOURS,
  RESOLUTION_SLA_HOURS,
  BUSINESS_HOURS,
  SUPPORT_HOLIDAYS,
  REOPEN_WINDOW_DAYS,
  LOOP_GUARD_MAX_OUTBOUND,
  LOOP_GUARD_WINDOW_MINUTES,
  SPAM_SCORE_THRESHOLD,
  TICKET_PREFIX,
  TICKET_COUNTER_NAME,
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_COUNT,
  ATTACHMENT_ALLOWED_MIME,
  ATTACHMENT_ALLOWED_EXT,
  formatTicketRef,
  parseTicketRef,
  canTransition,
};
