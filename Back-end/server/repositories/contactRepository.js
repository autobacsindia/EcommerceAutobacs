import BaseRepository from './baseRepository.js';
import Contact from '../models/Contact.js';

/**
 * Contact-message data access.
 *
 * Generic CRUD comes from BaseRepository. Two things need model-specific
 * methods: persisting a mutated document (admin reply / status update mutate
 * then save the loaded doc) and the status-breakdown aggregation used by the
 * dashboard analytics service (which chains `.option({ maxTimeMS })`).
 */
class ContactRepository extends BaseRepository {
  constructor() {
    super(Contact);
  }

  /** Persist a document loaded via findById and then mutated in the handler. */
  async save(contact, session = null) {
    if (session) return contact.save({ session });
    return contact.save();
  }

  /** Count of messages grouped by status, with a query-time cap. */
  async getStatusBreakdown(maxTimeMS) {
    return Contact.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]).option({ maxTimeMS });
  }
}

export default new ContactRepository();
