import NotificationLog from '../models/NotificationLog.js';

/**
 * NotificationLog data access. Passthrough to the model so existing query
 * chaining and the model's static helpers are preserved exactly; this keeps the
 * model import isolated to the repository layer per the architecture guard.
 */
class NotificationLogRepository {
  create(...args) { return NotificationLog.create(...args); }
  find(...args) { return NotificationLog.find(...args); }
  findOne(...args) { return NotificationLog.findOne(...args); }
  aggregate(...args) { return NotificationLog.aggregate(...args); }
  getOrderStats(...args) { return NotificationLog.getOrderStats(...args); }
}

export default new NotificationLogRepository();
