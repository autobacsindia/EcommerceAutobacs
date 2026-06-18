import Brand from '../models/Brand.js';

/**
 * Brand data access. Passthrough to the model so query chaining and instance
 * save() on a freshly built brand are preserved, while keeping the model import
 * isolated to the repository layer.
 */
class BrandRepository {
  find(...args) { return Brand.find(...args); }
  findOne(...args) { return Brand.findOne(...args); }
  findById(...args) { return Brand.findById(...args); }
  findByIdAndDelete(...args) { return Brand.findByIdAndDelete(...args); }
  countDocuments(...args) { return Brand.countDocuments(...args); }
  create(...args) { return Brand.create(...args); }
  /** Build an unsaved brand; caller mutates then save()s it. */
  build(data) { return new Brand(data); }
}

export default new BrandRepository();
