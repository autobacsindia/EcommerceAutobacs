import mongoose from 'mongoose';
import BaseRepository from './baseRepository.js';
import SalesQuotation from '../models/SalesQuotation.js';
import { readSummary, summaryPipeline } from '../utils/listQuery.js';

/** GTM quotations (models/SalesQuotation.js). Access rules live in salesQuotationService. */
/** `{ order: id }` in the shape the partial index quotation_order can serve. */
export const byOrderFilter = (orderId) => ({ order: { $eq: orderId, $type: 'objectId' } });

class SalesQuotationRepository extends BaseRepository {
  constructor() {
    super(SalesQuotation);
  }

  /** Keyset page: `query` already carries the "after the cursor" clause; `sort` is a Mongo sort. */
  async page(query, { sort, limit }) {
    return SalesQuotation.find(query).sort(sort).limit(limit).populate('salesUser', 'name').lean();
  }

  /** How many match and their total, counted over at most `cap` rows. */
  async summary(query, cap) {
    const [row] = await SalesQuotation.aggregate(summaryPipeline(query, cap, 'totalAmount')).option({ maxTimeMS: 5000 });
    return readSummary(row, cap, true);
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
