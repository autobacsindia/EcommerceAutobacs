import Cart from '../models/Cart.js';

class CartRepository {
  async clearCart(userId, session = null) {
    return Cart.findOneAndUpdate(
      { user: userId },
      { items: [] },
      session ? { session } : {}
    );
  }
}

export default new CartRepository();
