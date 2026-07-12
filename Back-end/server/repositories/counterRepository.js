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
}

export default new CounterRepository();
