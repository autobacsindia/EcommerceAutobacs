import ProductQuestion from '../models/ProductQuestion.js';

/**
 * ProductQuestion data access. Passthrough to the model so query chaining and
 * instance mutations on a loaded question are preserved, while keeping the model
 * import isolated to the repository layer.
 */
class ProductQuestionRepository {
  find(...args) { return ProductQuestion.find(...args); }
  findById(...args) { return ProductQuestion.findById(...args); }
  countDocuments(...args) { return ProductQuestion.countDocuments(...args); }
  deleteOne(...args) { return ProductQuestion.deleteOne(...args); }
  create(...args) { return ProductQuestion.create(...args); }
}

export default new ProductQuestionRepository();
