import OrderRating from '../models/OrderRating.js';

/**
 * OrderRating data access (services/orderRatingService.js). Passthrough so query
 * chaining is preserved while the model import stays in the repository layer.
 */
class OrderRatingRepository {
  findOne(...args) { return OrderRating.findOne(...args); }
  findOneAndUpdate(...args) { return OrderRating.findOneAndUpdate(...args); }
  exists(...args) { return OrderRating.exists(...args); }
  create(...args) { return OrderRating.create(...args); }
  aggregate(...args) { return OrderRating.aggregate(...args); }
}

export default new OrderRatingRepository();
