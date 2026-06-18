import Category from '../models/Category.js';

/**
 * Category data access. Passthrough to the model so query chaining works
 * unchanged and instance save() on a freshly built category is preserved, while
 * keeping the model import isolated to the repository layer.
 */
class CategoryRepository {
  find(...args) { return Category.find(...args); }
  findOne(...args) { return Category.findOne(...args); }
  findById(...args) { return Category.findById(...args); }
  findByIdAndUpdate(...args) { return Category.findByIdAndUpdate(...args); }
  create(...args) { return Category.create(...args); }
  countDocuments(...args) { return Category.countDocuments(...args); }
  /** Build an unsaved category; caller mutates then save()s it. */
  build(data) { return new Category(data); }
}

export default new CategoryRepository();
