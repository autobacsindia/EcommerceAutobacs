import BaseRepository from './baseRepository.js';
import StockNotificationRequest from '../models/StockNotificationRequest.js';

/**
 * Data access for back-in-stock ("Notify me") requests. All notify-me DB access
 * goes through here to satisfy the repository-pattern lint rule and keep the
 * idempotency/claim semantics in one place.
 */
class StockNotificationRequestRepository extends BaseRepository {
  constructor() {
    super(StockNotificationRequest);
  }

  /** All pending request ids for one target (variantId null = simple product). */
  findPendingIdsForTarget(productId, variantId = null) {
    return this.model
      .find({ product: productId, variantId: variantId ?? null, status: 'pending' })
      .select('_id')
      .lean();
  }

  /**
   * Atomically claim a pending request (pending → notified). Returns the updated
   * doc, or null if another run already claimed it — the guard that makes the
   * fan-out safe against re-fired hooks and overlapping restock events.
   */
  claimPending(id) {
    return this.model.findOneAndUpdate(
      { _id: id, status: 'pending' },
      { status: 'notified', notifiedAt: new Date() },
      { new: true }
    );
  }

  /** Populated single request for the send job (user email + product summary). */
  findByIdWithRefs(id) {
    return this.model
      .findById(id)
      .populate('user', 'name email')
      .populate('product', 'name slug images variants')
      .lean();
  }

  /** Existing pending row for a target/user, if any (drives the 200-vs-201 signal). */
  findPending(filter) {
    return this.model.findOne(filter).select('_id').lean();
  }

  /**
   * Idempotent upsert of a pending request on the partial-unique key. Returns
   * `{ request, created }` — `created` is read straight off the write-result
   * metadata (updatedExisting), so the caller needs no separate pre-read to tell
   * a fresh insert from an existing match.
   */
  async upsertPending(filter, email) {
    const res = await this.model.findOneAndUpdate(
      filter,
      { $setOnInsert: { ...filter, email, source: 'pdp' } },
      { new: true, upsert: true, setDefaultsOnInsert: true, includeResultMetadata: true }
    );
    return { request: res.value, created: !res.lastErrorObject?.updatedExisting };
  }

  /** The caller's own pending requests (optionally scoped to one product). */
  findMinePending(userId, productId = null) {
    const query = { user: userId, status: 'pending' };
    if (productId) query.product = productId;
    return this.model
      .find(query)
      .select('product variantId createdAt')
      .populate('product', 'name slug images')
      .sort({ createdAt: -1 })
      .lean();
  }

  /** Cancel one of the caller's own pending requests. */
  cancelMine(id, userId) {
    return this.model.findOneAndUpdate(
      { _id: id, user: userId, status: 'pending' },
      { status: 'cancelled' },
      { new: true }
    );
  }

  /**
   * Demand grouped per product/variant, highest demand first, paginated.
   * Returns { rows, total }.
   */
  async groupedByTarget(status, page, limit) {
    const result = await this.model.aggregate([
      { $match: { status } },
      {
        $group: {
          _id: { product: '$product', variantId: '$variantId' },
          count: { $sum: 1 },
          firstRequestedAt: { $min: '$createdAt' },
          lastRequestedAt: { $max: '$createdAt' },
        },
      },
      { $sort: { count: -1, lastRequestedAt: -1 } },
      {
        $facet: {
          rows: [{ $skip: (page - 1) * limit }, { $limit: limit }],
          total: [{ $count: 'value' }],
        },
      },
    ]);
    return {
      rows: result[0]?.rows || [],
      total: result[0]?.total?.[0]?.value || 0,
    };
  }

  /** Individual requesters waiting on one product/variant. */
  findRequesters(query) {
    return this.model
      .find(query)
      .select('user email status createdAt notifiedAt')
      .populate('user', 'name email')
      .sort({ createdAt: 1 })
      .lean();
  }
}

export default new StockNotificationRequestRepository();
