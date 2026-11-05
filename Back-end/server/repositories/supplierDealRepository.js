import SupplierDeal from '../models/SupplierDeal.js';

/**
 * Supplier deals (models/SupplierDeal.js). Data access only — who may do what,
 * and the money rules, live in services/supplierDealService.js.
 */
const supplierDealRepository = {
  create: async (doc) => (await SupplierDeal.create(doc)).toObject(),
  findById: (id) => SupplierDeal.findById(id).lean(),

  /** Open deals on an order (optionally only those covering `itemIds`), oldest first. Served by supplier_deal_order. */
  findOpenForOrder: (orderId, itemIds = [], limit = 50) => SupplierDeal.find({
    order: orderId, status: 'open', ...(itemIds.length ? { itemIds: { $in: itemIds } } : {}),
  }).sort({ createdAt: 1 }).limit(limit).lean(),

  /** Compare-and-set update: `filter` is added to the _id match. Null when it did not match. */
  updateIf: (id, filter, update) => SupplierDeal.findOneAndUpdate({ _id: id, ...filter }, update, { new: true }).lean(),

  /**
   * Take `paise` of the agreed total, only if it still fits. Returns the deal as it
   * was BEFORE, or null when it would go over (or the deal is not open).
   */
  reserve: (id, paise) => SupplierDeal.findOneAndUpdate(
    { _id: id, status: 'open', $expr: { $lte: [{ $add: ['$reservedPaise', paise] }, '$agreedPaise'] } },
    { $inc: { reservedPaise: paise } },
    { new: false },
  ).lean(),

  /** Give `paise` back; never below zero (a repeated release is a no-op). */
  release: (id, paise) => SupplierDeal.updateOne(
    { _id: id, reservedPaise: { $gte: paise } },
    { $inc: { reservedPaise: -paise } },
  ),
};

export default supplierDealRepository;
