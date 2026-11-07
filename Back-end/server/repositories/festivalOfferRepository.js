import FestivalOffer from '../models/FestivalOffer.js';

class FestivalOfferRepository {
  /** The singleton, or null when it has never been saved (= off). Read-only: never creates. */
  async find(session = null) {
    const q = FestivalOffer.findOne({ key: 'default' }).lean();
    if (session) q.session(session);
    return q;
  }

  async update(set) {
    return FestivalOffer.findOneAndUpdate(
      { key: 'default' },
      { $set: set },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true, lean: true },
    );
  }
}

export default new FestivalOfferRepository();
