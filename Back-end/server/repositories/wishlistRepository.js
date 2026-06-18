import Wishlist from '../models/Wishlist.js';

/**
 * Wishlist data access. Passthrough to the model so query chaining and instance
 * save() on a loaded wishlist are preserved, while keeping the model import
 * isolated to the repository layer.
 */
class WishlistRepository {
  find(...args) { return Wishlist.find(...args); }
  findOne(...args) { return Wishlist.findOne(...args); }
  findOneAndDelete(...args) { return Wishlist.findOneAndDelete(...args); }
  create(...args) { return Wishlist.create(...args); }
}

export default new WishlistRepository();
