import BaseRepository from './baseRepository.js';
import SupportTicket from '../models/SupportTicket.js';
import { OPEN_TICKET_STATUSES } from '../config/supportPolicy.js';

/**
 * Support-ticket data access.
 *
 * Generic CRUD comes from BaseRepository. What lives here are the queries the
 * inbox and the threading path need to run atomically or with a shape
 * BaseRepository cannot express.
 */
class SupportTicketRepository extends BaseRepository {
  constructor() {
    super(SupportTicket);
  }

  /** Persist a document loaded via findById and then mutated in a service. */
  async save(ticket, session = null) {
    if (session) return ticket.save({ session });
    return ticket.save();
  }

  /** Look up by the customer-facing reference ("ABI-1042"). */
  async findByReference(reference, populate = []) {
    let q = SupportTicket.findOne({ reference });
    populate.forEach((pop) => { q = q.populate(pop.path, pop.select); });
    return q;
  }

  /**
   * Find the ticket previously created for a source record, so the channel
   * adapters (product question, review, return) are idempotent and a retry or a
   * re-run of the backfill never creates a second ticket for the same row.
   */
  async findBySource(sourceModel, sourceId) {
    return SupportTicket.findOne({ sourceModel, sourceId });
  }

  /**
   * Most recent ticket for an email address, used to decide whether an inbound
   * message continues an existing conversation or starts a new one when the
   * RFC headers and the signed reply token are both unavailable.
   */
  async findLatestByRequesterEmail(email, { since = null } = {}) {
    const query = { 'requester.email': String(email || '').toLowerCase() };
    if (since) query.lastMessageAt = { $gte: since };
    return SupportTicket.findOne(query).sort({ lastMessageAt: -1 });
  }

  /**
   * Atomically claim the outbound-send budget for a ticket.
   *
   * Returns the updated document, on which the caller checks
   * `outboundInWindow` against LOOP_GUARD_MAX_OUTBOUND. Doing the increment and
   * the read in ONE findOneAndUpdate is what makes the loop guard correct under
   * concurrency — two workers racing on the same auto-responder storm would
   * each read a stale count with a separate read-then-write and both decide
   * they were under the limit.
   *
   * @param {mongoose.Types.ObjectId} ticketId
   * @param {Date} windowStart - start of the current guard window
   * @returns {Promise<Object|null>} the updated ticket
   */
  async claimOutboundSlot(ticketId, windowStart) {
    // Window has rolled over: reset the counter to 1 (this send) and restamp.
    const rolled = await SupportTicket.findOneAndUpdate(
      {
        _id: ticketId,
        $or: [
          { outboundWindowStart: null },
          { outboundWindowStart: { $lt: windowStart } },
        ],
      },
      { $set: { outboundInWindow: 1, outboundWindowStart: new Date() } },
      { new: true }
    );
    if (rolled) return rolled;

    // Still inside the window: increment and let the caller judge the total.
    return SupportTicket.findOneAndUpdate(
      { _id: ticketId },
      { $inc: { outboundInWindow: 1 } },
      { new: true }
    );
  }

  /**
   * Record activity after a message lands. `$max` on lastMessageAt keeps the
   * watermark monotonic even if an out-of-order backfill inserts an older
   * message after a newer one.
   */
  async recordMessageActivity(ticketId, { at, fromCustomer }, session = null) {
    const update = {
      $inc: { messageCount: 1 },
      $max: { lastMessageAt: at },
      $set: fromCustomer ? { lastCustomerMessageAt: at } : { lastAgentMessageAt: at },
    };
    const opts = { new: true };
    if (session) opts.session = session;
    return SupportTicket.findOneAndUpdate({ _id: ticketId }, update, opts);
  }

  /**
   * Stamp the first agent response exactly once. The `firstRespondedAt: null`
   * guard makes this idempotent — a second agent replying moments later must
   * not overwrite the measured first-response time.
   */
  async stampFirstResponse(ticketId, at) {
    return SupportTicket.findOneAndUpdate(
      { _id: ticketId, firstRespondedAt: null },
      { $set: { firstRespondedAt: at } },
      { new: true }
    );
  }

  /** Counts for the inbox header, in one round trip. */
  async getInboxCounts() {
    const [row] = await SupportTicket.aggregate([
      {
        $facet: {
          open: [{ $match: { status: { $in: OPEN_TICKET_STATUSES } } }, { $count: 'n' }],
          unassigned: [
            { $match: { status: { $in: OPEN_TICKET_STATUSES }, assignee: null } },
            { $count: 'n' },
          ],
          breached: [
            {
              $match: {
                status: { $in: OPEN_TICKET_STATUSES },
                firstResponseBreached: true,
              },
            },
            { $count: 'n' },
          ],
          awaitingCustomer: [{ $match: { status: 'pending_customer' } }, { $count: 'n' }],
        },
      },
    ]);
    const pick = (k) => row?.[k]?.[0]?.n || 0;
    return {
      open: pick('open'),
      unassigned: pick('unassigned'),
      breached: pick('breached'),
      awaitingCustomer: pick('awaitingCustomer'),
    };
  }

  /**
   * Still-open tickets whose first-response deadline has passed and which are
   * not yet flagged. This is the nightly safety net for BullMQ delayed jobs lost
   * to a Redis flush — the timers are the primary mechanism, this is the one
   * that catches what they dropped.
   */
  async findUnflaggedFirstResponseBreaches(now = new Date(), limit = 200) {
    return SupportTicket.find({
      status: { $in: OPEN_TICKET_STATUSES },
      firstRespondedAt: null,
      firstResponseBreached: false,
      firstResponseDueAt: { $ne: null, $lt: now },
    })
      .sort({ firstResponseDueAt: 1 })
      .limit(limit);
  }
}

export default new SupportTicketRepository();
