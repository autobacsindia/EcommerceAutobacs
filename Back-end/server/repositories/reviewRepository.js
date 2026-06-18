import Review from '../models/Review.js';

/**
 * Review data access. Passthrough to the model so query chaining and instance
 * save() on a freshly built review are preserved, while keeping the model import
 * isolated to the repository layer.
 */
class ReviewRepository {
  find(...args) { return Review.find(...args); }
  findOne(...args) { return Review.findOne(...args); }
  findById(...args) { return Review.findById(...args); }
  findByIdAndUpdate(...args) { return Review.findByIdAndUpdate(...args); }
  findByIdAndDelete(...args) { return Review.findByIdAndDelete(...args); }
  countDocuments(...args) { return Review.countDocuments(...args); }
  exists(...args) { return Review.exists(...args); }
  create(...args) { return Review.create(...args); }
  /** Build an unsaved review; caller mutates then save()s it. */
  build(data) { return new Review(data); }
}

export default new ReviewRepository();
