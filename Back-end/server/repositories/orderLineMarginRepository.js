import OrderLineMargin from '../models/OrderLineMargin.js';

/** The Margins report cache (models/OrderLineMargin.js). Data access only. */
const orderLineMarginRepository = {
  bulkWrite: (ops) => OrderLineMargin.bulkWrite(ops, { ordered: false }),
  /** Remove an order's rows for lines no longer bought from a supplier (or gone). */
  deleteOtherLines: (orderId, keepItemIds) => OrderLineMargin.deleteMany({ order: orderId, itemId: { $nin: keepItemIds } }),
  page: (query, sort, limit) => OrderLineMargin.find(query).sort(sort).limit(limit).lean(),
  aggregate: (pipeline) => OrderLineMargin.aggregate(pipeline),
};

export default orderLineMarginRepository;
