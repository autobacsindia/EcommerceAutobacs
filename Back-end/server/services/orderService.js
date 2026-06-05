import mongoose from 'mongoose';
import productRepository from '../repositories/productRepository.js';
import orderRepository from '../repositories/orderRepository.js';
import cartRepository from '../repositories/cartRepository.js';
import { getNotificationsQueue, getOrderQueue } from '../queue/queues.js';

class OrderService {
  /**
   * Validate each item against DB, re-price from DB, perform soft stock check.
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

      if (product.stock < item.quantity) {
        const err = new Error(
          `Insufficient stock for ${product.name}. Only ${product.stock} available`
        );
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
   * Atomically reserve stock for all items.
   *
   * When `session` is provided (inside a transaction), MongoDB rolls back
   * any already-deducted stock automatically on abort — no manual rollback.
   *
   * Without a session, we manually restore already-reserved units on failure.
   */
  async reserveStock(orderItems, session = null) {
    const reserved = [];

    for (const item of orderItems) {
      const updated = await productRepository.atomicDeductStock(
        item.product,
        item.quantity,
        session
      );

      if (!updated) {
        // Manual rollback only when there is no enclosing transaction
        if (!session && reserved.length > 0) {
          await Promise.all(
            reserved.map(r => productRepository.restoreStock(r.product, r.quantity))
          );
        }

        const current  = await productRepository.findById(item.product);
        const available = current?.stock ?? 0;
        const name     = current?.name ?? 'Product';
        const err = new Error(
          `${name} is out of stock. ${available > 0 ? `Only ${available} left` : 'No units available'}.`
        );
        err.status = 409;
        throw err;
      }

      reserved.push({ product: item.product, quantity: item.quantity });
    }

    return reserved;
  }

  /**
   * Full order creation flow.
   *
   * Validation (read-only) runs outside the transaction so the session lock is
   * held only for the three writes: stock deduction, order insert, cart clear.
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
    const tax          = Math.max(0, Number(orderData.tax)          || 0);
    const discount     = 0;

    // Validate + price OUTSIDE the transaction (pure reads, no write locks needed)
    const { orderItems, subtotal } = await this.validateAndPriceItems(items);

    const totalAmount = subtotal + shippingCost + tax - discount;
    if (totalAmount <= 0) {
      const err = new Error('Order total must be greater than zero');
      err.status = 400;
      throw err;
    }

    // ── Atomic transaction: deduct stock → create order → clear cart ──────────
    const isCod = paymentMethod === 'cod';

    // COD orders are confirmed immediately — no payment gateway to wait on.
    // Razorpay orders stay 'pending' until the payment.captured webhook fires.
    const initialStatus = isCod ? 'confirmed' : 'pending';

    const session = await mongoose.startSession();
    let order;

    try {
      await session.withTransaction(async () => {
        await this.reserveStock(orderItems, session);

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
            status: initialStatus,
            paymentMethod: paymentMethod || 'razorpay',
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
