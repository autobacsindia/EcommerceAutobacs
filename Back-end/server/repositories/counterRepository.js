import BaseRepository from './baseRepository.js';
import Counter from '../models/Counter.js';

/**
 * Access to the generic named atomic counters (invoice number series, etc.).
 * Keeps model access inside the repository layer (repo-pattern rule).
 */
class CounterRepository extends BaseRepository {
  constructor() {
    super(Counter);
  }

  /**
   * Atomically increment and return the next value for a named counter.
   * @param {string} name - counter name (e.g. "invoice")
   * @returns {Promise<number>}
   */
  async next(name) {
    return Counter.next(name);
  }

  /**
   * Bump a counter INSIDE a transaction. Two transactions that both bump the same
   * counter write-conflict, so one retries and sees what the other committed — the
   * way to make a "read a sum, then write" check safe against a twin running at the
   * same moment (services/payLaterService.js: the outstanding limit).
   */
  async bumpInSession(name, session) {
    await Counter.updateOne({ _id: name }, { $inc: { seq: 1 } }, { upsert: true, session });
  }
}

export default new CounterRepository();
