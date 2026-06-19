import mongoose from 'mongoose';
import productRepository from '../repositories/productRepository.js';
import orderRepository from '../repositories/orderRepository.js';
import cartRepository from '../repositories/cartRepository.js';
import { getNotificationsQueue, getOrderQueue } from '../queue/queues.js';
import { STOCK_STATUS } from '../utils/stockStatus.js';

class OrderService {
  /**
   * Validate each item against DB, re-price from DB, check availability.
   * Stock is a coarse status, so the only gate is "not out of stock".
   * Read-only — runs OUTSIDE the transaction so the session isn't held longer
   * than necessary.
   */
  async validateAndPriceItems(items) {
    const orderItems = [];
    let subtotal = 0;

    for (const item of items) {
      const product = await productRepository.findActiveById(item.product);

      if (!product) {
        const err = new Error(`Product ${item.product} not found or not available`);
        err.status = 400;
        throw err;
      }

      if (product.stock === STOCK_STATUS.OUT) {
        const err = new Error(`${product.name} is out of stock`);
        err.status = 400;
        throw err;
      }

      orderItems.push({
        product: product._id,
        quantity: item.quantity,
        price: product.price,   // always DB price, never client price
        name: product.name,
        image: product.images[0]?.url
      });

      subtotal += product.price * item.quantity;
    }

    return { orderItems, subtotal };
  }

  /**
   * Full order creation flow.
   *
   * Validation (read-only) runs outside the transaction so the session lock is
   * held only for the two writes: order insert and cart clear. Stock is a
   * coarse status, so there is no per-unit reservation/deduction.
   *
   * @param {string|ObjectId} userId
   * @param {Array}  items            [{product, quantity}]
   * @param {Object} shippingAddress
   * @param {Object} orderData        raw request body (shippingCost, tax)
   * @param {string} [paymentMethod]
   */
  async createOrder(userId, items, shippingAddress, orderData, paymentMethod) {
    // ── Price integrity: never trust client prices ────────────────────────────
    // discount is always 0 until a server-side coupon system is added.
    const shippingCost = Math.max(0, Number(orderData.shippingCost) || 0);
    const discount     = 0;

    // Validate + price OUTSIDE the transaction (pure reads, no write locks needed)
    const { orderItems, subtotal } = await this.validateAndPriceItems(items);

    // Prices are GST-inclusive ("Inclusive of all taxes").
    // tax is the GST portion extracted for display — it must NOT be added to subtotal.
    const tax         = Math.round((subtotal - subtotal / 1.18) * 100) / 100;
    const totalAmount = subtotal + shippingCost - discount;
    if (totalAmount <= 0) {
      const err = new Error('Order total must be greater than zero');
      err.status = 400;
      throw err;
    }

    // ── Atomic transaction: create order → clear cart ─────────────────────────
    const session = await mongoose.startSession();
    let order;

    try {
      await session.withTransaction(async () => {
        order = await orderRepository.create(
          {
            user: userId,
            items: orderItems,
            shippingAddress,
            subtotal,
            shippingCost,
            tax,
            discount,
            totalAmount,
            status: 'pending',
            ...(paymentMethod && { paymentMethod }),
            ...(orderData.sessionId && { sessionId: orderData.sessionId })
          },
          session
        );

        await cartRepository.clearCart(userId, session);
      });
    } finally {
      await session.endSession();
    }

    // ── Enqueue post-order background work ───────────────────────────────────
    // Fire-and-forget: the transaction already committed, so these are best-effort.
    // Each queue job retries independently on failure.
    if (process.env.REDIS_URL) {
      const enqueueErr = (name, err) =>
        console.error(`[Queue] Failed to enqueue ${name}:`, err.message);

      getNotificationsQueue()
        .add('send-confirmation-email', {
          orderId: order._id.toString(),
          userId:  userId.toString()
        })
        .catch(err => enqueueErr('send-confirmation-email', err));

      getOrderQueue()
        .add('post-order-created', {
          orderId: order._id.toString(),
          userId:  userId.toString()
        })
        .catch(err => enqueueErr('post-order-created', err));
    }

    return order;
  }
}

export default new OrderService();
