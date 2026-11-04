import mongoose from 'mongoose';

/**
 * A staff member's pinned order — kept at the top of every order list that
 * person sees, newest pin first (like pinned chats). PERSONAL: only the person
 * who pinned it sees it; nobody else's list changes. At most MAX_ORDER_PINS each
 * (services/orderPinService.js).
 *
 * A pin carries no permission of its own: every list still applies its own
 * scope, so pinning an order someone may not see shows them nothing.
 */
const OrderPinSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
  pinnedAt: { type: Date, required: true, default: Date.now },
}, { versionKey: false });

// One pin per person per order (a second tap is a no-op); "my pins, newest first".
// Same names in config/db.js ensureCriticalIndexes, which builds them in prod.
OrderPinSchema.index({ user: 1, order: 1 }, { unique: true, name: 'order_pin_user_order' });
OrderPinSchema.index({ user: 1, pinnedAt: -1 }, { name: 'order_pin_user_recent' });

export default mongoose.models.OrderPin || mongoose.model('OrderPin', OrderPinSchema);
