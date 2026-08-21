/**
 * Support ticket service — the state machine and the only place tickets are
 * created or mutated.
 *
 * ERRORS: throw AppError(message, status) — never `res.status(n)` then throw a
 * bare Error. errorMiddleware ignores an already-set response status, so a bare
 * throw ships as a 500 "Something went wrong" AND pages whoever is on call. This
 * repeats a mistake that previously reached production across 33 call sites in
 * returnController; do not reintroduce it here.
 *
 * Boundaries:
 *  - This module owns ticket/message state and the SLA clock.
 *  - It does NOT send email. Outbound goes through supportEmailService, enqueued
 *    by the caller, so a Postmark outage can never roll back a ticket write.
 *  - It does NOT parse email. That is inboundEmailService's job; it calls in
 *    here with already-clean values.
 */

import AppError from '../utils/AppError.js';
import ticketRepository from '../repositories/supportTicketRepository.js';
import messageRepository from '../repositories/supportMessageRepository.js';
import { messageIdFilter } from '../repositories/supportMessageRepository.js';
import counterRepository from '../repositories/counterRepository.js';
import { addBusinessHours } from '../utils/businessHours.js';
import {
  TICKET_COUNTER_NAME,
  FIRST_RESPONSE_SLA_HOURS,
  RESOLUTION_SLA_HOURS,
  SUPPORT_HOLIDAYS,
  REOPEN_WINDOW_DAYS,
  LOOP_GUARD_MAX_OUTBOUND,
  LOOP_GUARD_WINDOW_MINUTES,
  TICKET_STATUSES,
  TICKET_PRIORITIES,
  TICKET_CHANNELS,
  canTransition,
  formatTicketRef,
} from '../config/supportPolicy.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Normalise an email for storage and comparison. */
const normEmail = (v) => String(v || '').trim().toLowerCase();

/**
 * Compute the SLA deadlines for a ticket at its current priority.
 * Business-hours aware, so out-of-hours arrivals are not born breached.
 */
const computeSla = (priority, from = new Date()) => ({
  firstResponseDueAt: addBusinessHours(
    from,
    FIRST_RESPONSE_SLA_HOURS[priority] ?? FIRST_RESPONSE_SLA_HOURS.normal,
    SUPPORT_HOLIDAYS
  ),
  resolutionDueAt: addBusinessHours(
    from,
    RESOLUTION_SLA_HOURS[priority] ?? RESOLUTION_SLA_HOURS.normal,
    SUPPORT_HOLIDAYS
  ),
});

/**
 * Allocate the next human-facing reference ("ABI-1042") from the atomic Counter
 * series. Atomic by construction, so parallel creates cannot collide.
 */
const nextReference = async () =>
  formatTicketRef(await counterRepository.next(TICKET_COUNTER_NAME));

/**
 * Create a ticket.
 *
 * @param {Object} input
 * @param {string} input.subject
 * @param {string} input.channel - one of TICKET_CHANNELS
 * @param {Object} input.requester - { user?, email, name?, phone? }
 * @param {string} [input.priority='normal']
 * @param {Object} [input.context] - { order, returnRequest, product, review, lead }
 * @param {string} [input.sourceModel] - originating model name, for idempotency
 * @param {ObjectId} [input.sourceId]
 * @param {string[]} [input.tags]
 * @param {boolean} [input.requesterVerified=false]
 * @returns {Promise<Object>} the created (or pre-existing) ticket document
 */
export const createTicket = async ({
  subject,
  channel,
  requester,
  priority = 'normal',
  context = {},
  sourceModel = null,
  sourceId = null,
  tags = [],
  requesterVerified = false,
} = {}) => {
  const email = normEmail(requester?.email);
  if (!email) throw new AppError('A requester email is required to open a ticket.', 400);
  if (!TICKET_CHANNELS.includes(channel)) {
    throw new AppError(`Unknown support channel: ${channel}`, 400);
  }
  if (!TICKET_PRIORITIES.includes(priority)) {
    throw new AppError(`Unknown ticket priority: ${priority}`, 400);
  }

  // Adapter idempotency: one ticket per source record. Checked before insert for
  // a clean result, and enforced by a unique partial index for the race.
  if (sourceModel && sourceId) {
    const existing = await ticketRepository.findBySource(sourceModel, sourceId);
    if (existing) return existing;
  }

  const now = new Date();
  const sla = computeSla(priority, now);

  const doc = {
    reference: await nextReference(),
    subject: String(subject || '').trim().slice(0, 500) || '(no subject)',
    channel,
    priority,
    status: 'new',
    requester: {
      user: requester?.user || null,
      email,
      name: String(requester?.name || '').trim(),
      phone: String(requester?.phone || '').trim(),
    },
    order: context.order || null,
    returnRequest: context.returnRequest || null,
    product: context.product || null,
    review: context.review || null,
    lead: context.lead || null,
    sourceModel,
    sourceId,
    tags,
    requesterVerified,
    lastMessageAt: now,
    ...sla,
  };

  try {
    return await ticketRepository.create(doc);
  } catch (err) {
    // Lost the race on the source-idempotency index — return the winner rather
    // than surfacing a duplicate-key error to a customer-facing endpoint.
    if (err?.code === 11000 && sourceModel && sourceId) {
      const winner = await ticketRepository.findBySource(sourceModel, sourceId);
      if (winner) return winner;
    }
    throw err;
  }
};

/**
 * Append a message to a ticket and move the ticket's state accordingly.
 *
 * Status side effects (deliberately encoded here, not in callers):
 *  - a customer message on a ticket we were waiting on flips it back to `open`
 *  - a customer message on a recently-resolved ticket REOPENS it
 *  - an agent public reply flips it to `pending_customer`
 *  - an auto-reply does none of the above (see isAutoReply in supportSanitizer)
 *
 * @param {Object} input
 * @param {ObjectId|string} input.ticketId
 * @param {'inbound'|'outbound'} input.direction
 * @param {'public'|'internal'} [input.visibility='public']
 * @param {Object} input.author - { user?, email?, name?, isAgent }
 * @param {string} [input.bodyText]
 * @param {string} [input.bodyHtml]
 * @param {string} [input.bodyRaw]
 * @param {Array} [input.attachments]
 * @param {Array} [input.rejectedAttachments]
 * @param {string} [input.messageId] - RFC Message-ID (inbound)
 * @param {string} [input.inReplyTo]
 * @param {string[]} [input.references]
 * @param {boolean} [input.isAutoReply=false]
 * @param {number} [input.spamScore]
 * @returns {Promise<{ ticket: Object, message: Object }>}
 */
export const addMessage = async ({
  ticketId,
  direction,
  visibility = 'public',
  author = {},
  bodyText = '',
  bodyHtml = '',
  bodyRaw = '',
  attachments = [],
  rejectedAttachments = [],
  messageId = null,
  inReplyTo = null,
  references = [],
  providerMessageId = null,
  providerStream = null,
  isAutoReply = false,
  spamScore = null,
} = {}) => {
  const ticket = await ticketRepository.findById(ticketId);
  if (!ticket) throw new AppError('Support ticket not found.', 404);
  if (ticket.mergedInto) {
    throw new AppError('This ticket was merged and can no longer be replied to.', 409);
  }

  const now = new Date();
  let message;
  try {
    message = await messageRepository.create({
      ticket: ticket._id,
      direction,
      visibility,
      author: {
        user: author.user || null,
        email: normEmail(author.email),
        name: String(author.name || '').trim(),
        isAgent: Boolean(author.isAgent),
      },
      bodyText,
      bodyHtml,
      bodyRaw,
      attachments,
      rejectedAttachments,
      messageId,
      inReplyTo,
      references,
      providerMessageId,
      providerStream,
      isAutoReply,
      spamScore,
      deliveryStatus: direction === 'outbound' ? 'pending' : 'delivered',
    });
  } catch (err) {
    // Unique index on messageId: a Postmark webhook retry replayed a message we
    // already stored. Treat as success and hand back what we have — retries must
    // be no-ops, not duplicate replies in the customer's thread.
    if (err?.code === 11000 && messageId) {
      const existing = await messageRepository.findOne(messageIdFilter(messageId));
      if (existing) return { ticket, message: existing };
    }
    throw err;
  }

  // Internal notes are invisible to the customer and must not touch the SLA
  // clock, the activity watermarks, or the ticket's status.
  if (visibility === 'internal') {
    return { ticket, message };
  }

  const fromCustomer = direction === 'inbound';
  await ticketRepository.recordMessageActivity(
    ticket._id,
    { at: now, fromCustomer },
    null
  );

  // An agent's first public reply stops the first-response clock, exactly once.
  if (!fromCustomer && !ticket.firstRespondedAt) {
    await ticketRepository.stampFirstResponse(ticket._id, now);
  }

  const nextStatus = resolveStatusAfterMessage(ticket, { fromCustomer, isAutoReply, now });
  if (nextStatus && nextStatus !== ticket.status) {
    await applyStatus(ticket._id, nextStatus, { at: now });
  }

  const fresh = await ticketRepository.findById(ticket._id);
  return { ticket: fresh, message };
};

/**
 * Decide the status a ticket should hold after a message lands.
 * Pure and exported so the behaviour is unit-testable without a database.
 *
 * @returns {string|null} the new status, or null to leave it unchanged
 */
export const resolveStatusAfterMessage = (ticket, { fromCustomer, isAutoReply, now = new Date() }) => {
  // Machine-generated mail is not a customer speaking: it must not reopen a
  // resolved ticket, and must not pull a pending ticket back into the queue.
  if (isAutoReply) return null;

  if (fromCustomer) {
    if (ticket.status === 'resolved' || ticket.status === 'closed') {
      const settledAt = ticket.resolvedAt || ticket.closedAt || ticket.updatedAt;
      const withinWindow = settledAt
        && (now.getTime() - new Date(settledAt).getTime()) <= REOPEN_WINDOW_DAYS * DAY_MS;
      // Outside the window the caller opens a NEW ticket instead (see
      // inboundEmailService); resurrecting months-old context here would also
      // corrupt resolution-time metrics.
      return withinWindow ? 'open' : null;
    }
    // Customer came back while we were waiting on them, or the ticket is fresh.
    return ticket.status === 'pending_customer' || ticket.status === 'new'
      ? 'open'
      : null;
  }

  // Agent replied publicly — the ball is now in the customer's court.
  return ['new', 'open'].includes(ticket.status) ? 'pending_customer' : null;
};

/**
 * Apply a status change with its timestamp side effects. Internal helper; public
 * callers go through `transitionStatus`, which validates the move first.
 */
const applyStatus = async (ticketId, status, { at = new Date() } = {}) => {
  const set = { status };
  if (status === 'resolved') set.resolvedAt = at;
  if (status === 'closed') set.closedAt = at;
  // Reopening clears the resolution stamps so the ticket is not counted as both
  // open and resolved by the metrics aggregation.
  if (status === 'open') {
    set.resolvedAt = null;
    set.closedAt = null;
  }
  return ticketRepository.update(ticketId, { $set: set });
};

/**
 * Move a ticket to a new status, enforcing the state machine.
 *
 * @param {ObjectId|string} ticketId
 * @param {string} status
 * @param {Object} [actor] - { user, name } for the audit trail
 * @returns {Promise<Object>} the updated ticket
 */
export const transitionStatus = async (ticketId, status, actor = {}) => {
  if (!TICKET_STATUSES.includes(status)) {
    throw new AppError(`Unknown ticket status: ${status}`, 400);
  }
  const ticket = await ticketRepository.findById(ticketId);
  if (!ticket) throw new AppError('Support ticket not found.', 404);
  if (ticket.mergedInto) {
    throw new AppError('This ticket was merged and can no longer be modified.', 409);
  }
  if (!canTransition(ticket.status, status)) {
    throw new AppError(
      `A ticket cannot move from "${ticket.status}" to "${status}".`,
      422
    );
  }

  await applyStatus(ticket._id, status);

  if (actor?.user) {
    await addMessage({
      ticketId: ticket._id,
      direction: 'outbound',
      visibility: 'internal',
      author: { user: actor.user, name: actor.name, isAgent: true },
      bodyText: `Status changed from "${ticket.status}" to "${status}".`,
    });
  }

  return ticketRepository.findById(ticket._id);
};

/**
 * Assign (or unassign, with `null`) a ticket. Assigning a brand-new ticket also
 * moves it to `open` — an owned ticket is by definition being worked.
 */
export const assignTicket = async (ticketId, assigneeId, actor = {}) => {
  const ticket = await ticketRepository.findById(ticketId);
  if (!ticket) throw new AppError('Support ticket not found.', 404);
  if (ticket.mergedInto) {
    throw new AppError('This ticket was merged and can no longer be modified.', 409);
  }

  const set = { assignee: assigneeId || null };
  if (assigneeId && ticket.status === 'new') set.status = 'open';
  await ticketRepository.update(ticket._id, { $set: set });

  if (actor?.user) {
    await addMessage({
      ticketId: ticket._id,
      direction: 'outbound',
      visibility: 'internal',
      author: { user: actor.user, name: actor.name, isAgent: true },
      bodyText: assigneeId ? 'Ticket assigned.' : 'Ticket unassigned.',
    });
  }

  return ticketRepository.findById(ticket._id);
};

/**
 * Change priority and recompute the SLA deadlines from now.
 *
 * Recomputing from `now` rather than from creation is deliberate: escalating a
 * day-old ticket to `urgent` should give the team the urgent response window
 * from the moment of escalation, not mark it instantly breached.
 */
export const setPriority = async (ticketId, priority, actor = {}) => {
  if (!TICKET_PRIORITIES.includes(priority)) {
    throw new AppError(`Unknown ticket priority: ${priority}`, 400);
  }
  const ticket = await ticketRepository.findById(ticketId);
  if (!ticket) throw new AppError('Support ticket not found.', 404);

  const set = { priority };
  // Only the still-running clocks move; a met deadline stays as measured.
  if (!ticket.firstRespondedAt) {
    set.firstResponseDueAt = computeSla(priority).firstResponseDueAt;
  }
  if (!ticket.resolvedAt) {
    set.resolutionDueAt = computeSla(priority).resolutionDueAt;
  }
  await ticketRepository.update(ticket._id, { $set: set });

  if (actor?.user) {
    await addMessage({
      ticketId: ticket._id,
      direction: 'outbound',
      visibility: 'internal',
      author: { user: actor.user, name: actor.name, isAgent: true },
      bodyText: `Priority changed from "${ticket.priority}" to "${priority}".`,
    });
  }

  return ticketRepository.findById(ticket._id);
};

/**
 * Claim one outbound-email slot for a ticket.
 *
 * Returns `{ allowed, count }`. When `allowed` is false the caller MUST NOT
 * send: the ticket has exceeded LOOP_GUARD_MAX_OUTBOUND sends inside the
 * current window, which in practice means we are ping-ponging with an
 * autoresponder. The trip is stamped on the ticket so an operator can see why a
 * thread went quiet.
 *
 * The increment is atomic in the repository — a read-then-write here would let
 * two concurrent workers both believe they were under the limit.
 */
export const claimOutboundSlot = async (ticketId) => {
  const windowStart = new Date(Date.now() - LOOP_GUARD_WINDOW_MINUTES * 60 * 1000);
  const updated = await ticketRepository.claimOutboundSlot(ticketId, windowStart);
  if (!updated) throw new AppError('Support ticket not found.', 404);

  const count = updated.outboundInWindow || 0;
  if (count > LOOP_GUARD_MAX_OUTBOUND) {
    if (!updated.loopGuardTrippedAt) {
      await ticketRepository.update(ticketId, {
        $set: { loopGuardTrippedAt: new Date() },
      });
    }
    return { allowed: false, count };
  }
  return { allowed: true, count };
};

/**
 * Find the ticket a customer reply belongs to, or decide a new one is needed.
 *
 * Resolution order — most to least trustworthy:
 *   1. RFC 5322 In-Reply-To / References matched against Message-IDs we sent.
 *      Standards-based and exact.
 *   2. A signed reply-to token (handled by the caller before this point).
 *   3. The ABI-nnnn reference in the subject line, as a last resort.
 *
 * Returns `{ ticket, reason }`, with `ticket` null when the caller should open a
 * fresh one.
 */
export const resolveTicketForReply = async ({
  inReplyTo = null,
  references = [],
  subjectRef = null,
  fromEmail = '',
} = {}) => {
  const candidates = [inReplyTo, ...(references || [])].filter(Boolean);
  if (candidates.length) {
    const priorMessage = await messageRepository.findByAnyMessageId(candidates);
    if (priorMessage?.ticket) {
      const ticket = await ticketRepository.findById(priorMessage.ticket);
      if (ticket && !ticket.mergedInto) return { ticket, reason: 'references' };
    }
  }

  if (subjectRef) {
    const ticket = await ticketRepository.findByReference(subjectRef);
    // The subject line is trivially forged, so a match is only honoured when the
    // sender is the person the ticket belongs to. Without this check anyone
    // could read or inject into any ticket by guessing "ABI-1042".
    if (ticket && !ticket.mergedInto
        && normEmail(ticket.requester.email) === normEmail(fromEmail)) {
      return { ticket, reason: 'subject' };
    }
  }

  return { ticket: null, reason: 'new' };
};

export default {
  createTicket,
  addMessage,
  transitionStatus,
  assignTicket,
  setPriority,
  claimOutboundSlot,
  resolveTicketForReply,
  resolveStatusAfterMessage,
};
