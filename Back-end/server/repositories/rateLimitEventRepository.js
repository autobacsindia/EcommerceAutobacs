import RateLimitEvent from '../models/RateLimitEvent.js';

/**
 * RateLimitEvent data access. Passthrough to the model — preserves the native
 * query chaining and the analytics static helpers while keeping the model
 * import isolated to the repository layer.
 */
class RateLimitEventRepository {
  create(...args) { return RateLimitEvent.create(...args); }
  find(...args) { return RateLimitEvent.find(...args); }
  countDocuments(...args) { return RateLimitEvent.countDocuments(...args); }
  aggregate(...args) { return RateLimitEvent.aggregate(...args); }
  getEventCountsByType(...args) { return RateLimitEvent.getEventCountsByType(...args); }
  getTopRateLimitedEndpoints(...args) { return RateLimitEvent.getTopRateLimitedEndpoints(...args); }
  getUserImpactMetrics(...args) { return RateLimitEvent.getUserImpactMetrics(...args); }
  getRetrySuccessRate(...args) { return RateLimitEvent.getRetrySuccessRate(...args); }
}

export default new RateLimitEventRepository();
