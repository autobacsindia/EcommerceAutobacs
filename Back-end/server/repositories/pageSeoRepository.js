import PageSeo from '../models/PageSeo.js';

/**
 * PageSeo data access. Keeps the model import isolated to the repository layer
 * (lint rule: no-restricted-imports) while preserving query chaining.
 */
class PageSeoRepository {
  find(...args) { return PageSeo.find(...args); }
  findOne(...args) { return PageSeo.findOne(...args); }
  findOneAndUpdate(...args) { return PageSeo.findOneAndUpdate(...args); }
}

export default new PageSeoRepository();
