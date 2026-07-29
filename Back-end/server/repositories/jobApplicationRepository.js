import JobApplication from '../models/JobApplication.js';

/**
 * JobApplication data access. Passthrough to the model plus a paginated admin
 * inbox query, keeping the model import isolated to the repository layer.
 */
class JobApplicationRepository {
  findById(...args) { return JobApplication.findById(...args); }
  create(...args) { return JobApplication.create(...args); }
  countDocuments(...args) { return JobApplication.countDocuments(...args); }

  /** Paginated admin list, newest first, optional status filter. */
  async listPaged({ filter = {}, page = 1, limit = 25 }) {
    const skip = (Math.max(1, page) - 1) * limit;
    const [items, total] = await Promise.all([
      JobApplication.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('posting', 'title slug department status')
        .lean(),
      JobApplication.countDocuments(filter),
    ]);
    return { items, total, page: Math.max(1, page), pages: Math.max(1, Math.ceil(total / limit)) };
  }

  findByIdPopulated(id) {
    return JobApplication.findById(id).populate('posting', 'title slug department status').lean();
  }
}

export default new JobApplicationRepository();
