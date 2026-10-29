import mongoose from 'mongoose';
import BaseRepository from './baseRepository.js';
import SalesQuotation from '../models/SalesQuotation.js';

/** GTM quotations (models/SalesQuotation.js). Access rules live in salesQuotationService. */
/** `{ order: id }` in the shape the partial index quotation_order can serve. */
export const byOrderFilter = (orderId) => ({ order: { $eq: orderId, $type: 'objectId' } });

class SalesQuotationRepository extends BaseRepository {
  constructor() {
    super(SalesQuotation);
  }

  /** Newest first, keyset on _id (index quotation_seller_recent / quotation_status_recent). */
  async page(filter, { before = null, limit = 25 } = {}) {
    const q = { ...filter, ...(before ? { _id: { $lt: before } } : {}) };
    return SalesQuotation.find(q).sort({ _id: -1 }).limit(limit).lean();
  }

  /**
   * The quotation an order was accepted from. The `$type` is what lets the planner
   * use the PARTIAL index quotation_order — a bare `{ order: id }` does not imply the
   * index's `{ $type: 'objectId' }` filter and scans the whole collection.
   */
  async findByOrder(orderId, select = 'number version') {
    return SalesQuotation.findOne(byOrderFilter(orderId)).select(select).lean();
  }

  /** Who the quotation is for and who sells it — nothing else (customer bank details). */
  async findContact(id) {
    return SalesQuotation.findById(id).select('customer salesUser').lean();
  }

  /**
   * Move an OPEN quotation on, atomically: only one of two concurrent "accept" or
   * "edit" clicks can win; the loser gets null.
   */
  async updateIfOpen(id, update, { session = null } = {}) {
    return SalesQuotation.findOneAndUpdate({ _id: id, status: 'open' }, update, { new: true, session }).lean();
  }

  /** Run `fn(session)` in one MongoDB transaction (retried on transient conflicts). */
  async inTransaction(fn) {
    const session = await mongoose.startSession();
    try {
      let out;
      await session.withTransaction(async () => { out = await fn(session); });
      return out;
    } finally {
      await session.endSession();
    }
  }
}

export default new SalesQuotationRepository();
