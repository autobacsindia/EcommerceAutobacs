import BaseRepository from './baseRepository.js';
import SupportMessage from '../models/SupportMessage.js';

/**
 * Support-message data access.
 *
 * The threading lookups are the interesting part: given an inbound reply, find
 * which ticket it belongs to by matching the RFC 5322 identifiers it carries.
 */
/**
 * Lookup filters for the `messageId_1` unique PARTIAL index.
 *
 * The index is filtered on `{ messageId: { $type: 'string' } }` because
 * `messageId` is `default: null` and `sparse` therefore could not exclude the
 * in-app messages that carry no Message-ID (see models/SupportMessage.js).
 *
 * MongoDB's planner will not infer that a bare equality or `$in` predicate falls
 * inside a `$type` partial filter, so the unqualified form discards the index
 * and COLLSCANs. Restating `$type` makes the predicate a provable subset.
 * Same defect class as repositories/cartRepository.js.
 */
export const messageIdFilter = (messageId) => ({
  messageId: { $eq: messageId, $type: 'string' },
});

export const messageIdInFilter = (ids) => ({
  messageId: { $in: ids, $type: 'string' },
});

class SupportMessageRepository extends BaseRepository {
  constructor() {
    super(SupportMessage);
  }

  async save(message, session = null) {
    if (session) return message.save({ session });
    return message.save();
  }

  /**
   * Full thread, oldest first.
   *
   * `includeInternal` MUST be false for any customer-facing caller. Filtering
   * happens here in the query rather than in the serializer so an internal note
   * can never leak through a route that forgot to strip it — the rows simply are
   * not fetched.
   */
  async findThread(ticketId, { includeInternal = false } = {}) {
    const query = { ticket: ticketId };
    if (!includeInternal) query.visibility = 'public';
    return SupportMessage.find(query).sort({ createdAt: 1 }).lean();
  }

  /**
   * Resolve a ticket from an inbound message's RFC identifiers.
   *
   * An email client replying to our mail echoes the message it answers in
   * `In-Reply-To`, and the whole ancestry in `References`. Matching any of those
   * against the Message-IDs we have sent identifies the conversation exactly —
   * this is the most reliable threading signal available and is tried first.
   *
   * @param {string[]} candidateIds - the reply's In-Reply-To + References values
   * @returns {Promise<Object|null>} the matched message (with its `ticket`)
   */
  async findByAnyMessageId(candidateIds = []) {
    const ids = candidateIds.filter(Boolean);
    if (!ids.length) return null;
    return SupportMessage.findOne({
      $or: [
        messageIdInFilter(ids),
        { references: { $in: ids } },
      ],
    })
      .sort({ createdAt: -1 })
      .lean();
  }

  /** Idempotency probe: have we already stored this exact inbound message? */
  async existsByMessageId(messageId) {
    if (!messageId) return false;
    const hit = await SupportMessage.exists(messageIdFilter(messageId));
    return Boolean(hit);
  }

  /** Newest first — used to render "last reply" previews in the inbox list. */
  async findLatestForTickets(ticketIds = []) {
    if (!ticketIds.length) return [];
    return SupportMessage.aggregate([
      { $match: { ticket: { $in: ticketIds }, visibility: 'public' } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: '$ticket',
          bodyText: { $first: '$bodyText' },
          direction: { $first: '$direction' },
          createdAt: { $first: '$createdAt' },
        },
      },
    ]);
  }

  /** Update delivery state from a Postmark delivery/bounce webhook. */
  async markDelivery(providerMessageId, status, error = '') {
    if (!providerMessageId) return null;
    return SupportMessage.findOneAndUpdate(
      { providerMessageId },
      { $set: { deliveryStatus: status, deliveryError: error } },
      { new: true }
    );
  }

  /**
   * How many emails this ticket has sent since `since` — the audit counterpart
   * to the atomic counter on the ticket. Used by the loop-guard alert to report
   * what actually happened, and to recover the true count if the denormalised
   * counter is ever reset.
   */
  async countOutboundSince(ticketId, since) {
    return SupportMessage.countDocuments({
      ticket: ticketId,
      direction: 'outbound',
      createdAt: { $gte: since },
    });
  }
}

export default new SupportMessageRepository();
