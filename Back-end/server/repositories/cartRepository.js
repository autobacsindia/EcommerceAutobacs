import Cart from '../models/Cart.js';

/**
 * Cart lookup filters — the ONLY supported way to query a cart by owner.
 *
 * WHY THESE EXIST
 * ---------------
 * `sessionId_1` and `user_1` are UNIQUE PARTIAL indexes scoped with `$type`
 * (see models/Cart.js — `$ne` is rejected in a partialFilterExpression, so
 * `$type` is the only expression that both builds and expresses the intent).
 *
 * The catch nobody checked: MongoDB's planner will not INFER that an equality
 * predicate satisfies a `$type` partial filter. A bare `{ sessionId }` query is
 * not provably inside `{ sessionId: { $type: 'string' } }` as far as the planner
 * is concerned, so it silently discards the index and COLLSCANs the collection.
 * Measured against production (59,638 carts):
 *
 *   findOne({ sessionId })                      COLLSCAN  59,637 docs   31ms
 *   findOne(sessionCartFilter(sessionId))       IXSCAN         0 docs    0ms
 *
 * At ~59,638 documents examined per lookup that is a 59,638:1 query-targeting
 * ratio on the hottest guest route, which is what drove the Atlas "Scanned
 * Objects / Returned above 1000" alert. Restating `$type` in the query is what
 * makes the predicate a provable subset of the partial filter.
 *
 * This is the third instalment of the same landmine family: a declared index is
 * not a built index, and a BUILT index is not a USED index.
 *
 * Never hand-write `{ sessionId }` or `{ user }` against Cart — use these.
 * tests/cartIndexUsage.test.js fails if the bare form is reintroduced.
 */
export const sessionCartFilter = (sessionId) => ({
  sessionId: { $eq: sessionId, $type: 'string' },
});

export const userCartFilter = (userId) => ({
  user: { $eq: userId, $type: 'objectId' },
});

class CartRepository {
  async clearCart(userId, session = null) {
    return Cart.findOneAndUpdate(
      userCartFilter(userId),
      { items: [] },
      session ? { session } : {}
    );
  }
}

export default new CartRepository();
