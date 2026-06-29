import BaseRepository from './baseRepository.js';
import KarmaLedger from '../models/KarmaLedger.js';

class KarmaLedgerRepository extends BaseRepository {
  constructor() {
    super(KarmaLedger);
  }

  async findOneBy(query, session = null) {
    let q = KarmaLedger.findOne(query);
    if (session) q = q.session(session);
    return q;
  }

  async findByUser(userId, { skip = 0, limit = 20 } = {}) {
    return KarmaLedger.find({ user: userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();
  }

  async countByUser(userId) {
    return KarmaLedger.countDocuments({ user: userId });
  }
}

export default new KarmaLedgerRepository();
