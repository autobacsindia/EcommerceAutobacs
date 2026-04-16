/**
 * Base Repository - Common database operations
 * 
 * All repositories should extend this class
 */

class BaseRepository {
  constructor(model) {
    this.model = model;
  }

  /**
   * Find documents by query
   */
  async find(query, options = {}) {
    const {
      limit = 0,
      skip = 0,
      sort = { createdAt: -1 },
      populate = [],
      select = null
    } = options;

    let queryBuilder = this.model.find(query);

    if (select) {
      queryBuilder = queryBuilder.select(select);
    }

    if (populate.length > 0) {
      populate.forEach(pop => {
        queryBuilder = queryBuilder.populate(pop.path, pop.select);
      });
    }

    return queryBuilder
      .sort(sort)
      .skip(skip)
      .limit(limit);
  }

  /**
   * Find single document by ID
   */
  async findById(id, populate = []) {
    let query = this.model.findById(id);
    
    if (populate.length > 0) {
      populate.forEach(pop => {
        query = query.populate(pop.path, pop.select);
      });
    }

    return query;
  }

  /**
   * Find single document by field
   */
  async findOne(query, populate = []) {
    let queryBuilder = this.model.findOne(query);
    
    if (populate.length > 0) {
      populate.forEach(pop => {
        queryBuilder = queryBuilder.populate(pop.path, pop.select);
      });
    }

    return queryBuilder;
  }

  /**
   * Count documents
   */
  async count(query = {}) {
    return this.model.countDocuments(query);
  }

  /**
   * Create new document
   */
  async create(data) {
    return this.model.create(data);
  }

  /**
   * Update document by ID
   */
  async update(id, updateData, options = {}) {
    return this.model.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
      ...options
    });
  }

  /**
   * Delete document by ID
   */
  async delete(id) {
    return this.model.findByIdAndDelete(id);
  }

  /**
   * Check if document exists
   */
  async exists(id) {
    const count = await this.model.countDocuments({ _id: id });
    return count > 0;
  }

  /**
   * Aggregate pipeline
   */
  async aggregate(pipeline) {
    return this.model.aggregate(pipeline);
  }
}

export default BaseRepository;
