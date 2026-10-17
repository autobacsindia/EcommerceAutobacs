import BaseRepository from './baseRepository.js';
import SalesQuotation from '../models/SalesQuotation.js';

/** GTM quotations (models/SalesQuotation.js). Access rules live in salesQuotationService. */
class SalesQuotationRepository extends BaseRepository {
  constructor() {
    super(SalesQuotation);
  }

  /** Newest first, keyset on _id (index quotation_seller_recent / quotation_status_recent). */
  async page(filter, { before = null, limit = 25 } = {}) {
    const q = { ...filter, ...(before ? { _id: { $lt: before } } : {}) };
    return SalesQuotation.find(q).sort({ _id: -1 }).limit(limit).lean();
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
}

export default new SalesQuotationRepository();
