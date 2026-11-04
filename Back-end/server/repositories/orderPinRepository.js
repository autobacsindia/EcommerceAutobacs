import BaseRepository from './baseRepository.js';
import OrderPin from '../models/OrderPin.js';

/** Personal order pins (models/OrderPin.js). */
class OrderPinRepository extends BaseRepository {
  constructor() {
    super(OrderPin);
  }

  /** This person's pins, newest first — bounded by `limit` (the pin cap). */
  async findForUser(userId, limit) {
    return OrderPin.find({ user: userId }).sort({ pinnedAt: -1, _id: -1 }).limit(limit).lean();
  }

  async countForUser(userId) {
    return OrderPin.countDocuments({ user: userId });
  }

  /** Pin; an order already pinned keeps its pin (idempotent under a double tap). */
  async pin(userId, orderId, at = new Date()) {
    const res = await OrderPin.updateOne(
      { user: userId, order: orderId },
      { $setOnInsert: { user: userId, order: orderId, pinnedAt: at } },
      { upsert: true },
    );
    return res.upsertedCount === 1;
  }

  async unpin(userId, orderId) {
    const res = await OrderPin.deleteOne({ user: userId, order: orderId });
    return res.deletedCount === 1;
  }
}

export default new OrderPinRepository();
