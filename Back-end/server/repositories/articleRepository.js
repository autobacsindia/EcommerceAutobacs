import Article from '../models/Article.js';

/**
 * Article data access. Passthrough to the model so existing query chaining is
 * preserved exactly, while keeping the model import isolated to the repository
 * layer.
 */
class ArticleRepository {
  find(...args) { return Article.find(...args); }
  findOne(...args) { return Article.findOne(...args); }
  findById(...args) { return Article.findById(...args); }
  findByIdAndDelete(...args) { return Article.findByIdAndDelete(...args); }
  updateOne(...args) { return Article.updateOne(...args); }
  countDocuments(...args) { return Article.countDocuments(...args); }
  distinct(...args) { return Article.distinct(...args); }
  create(...args) { return Article.create(...args); }
}

export default new ArticleRepository();
