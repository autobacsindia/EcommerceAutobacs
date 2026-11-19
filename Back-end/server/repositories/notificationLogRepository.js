import NotificationLog from '../models/NotificationLog.js';

/** Forward order of WhatsApp delivery statuses. `failed` is handled separately. */
const DELIVERY_RANK = ['accepted', 'sent', 'delivered', 'read'];

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

  /** Write a log row once per notificationId (a retried job updates, never duplicates). */
  upsertByNotificationId(notificationId, fields) {
    // notificationId must not also be in $set: Mongo refuses the same path in both.
    const { notificationId: _ignored, ...rest } = fields;
    return NotificationLog.updateOne(
      { notificationId },
      { $set: rest, $setOnInsert: { notificationId } },
      { upsert: true, runValidators: true },
    );
  }

  /**
   * Apply a WhatsApp delivery status — only if it moves the message FORWARD.
   *
   * Meta delivers statuses out of order and more than once (a `read` can land before
   * its `delivered`). The filter matches only rows whose current status is earlier, so
   * a late `delivered` after `read` matches nothing and changes nothing. `failed`
   * replaces only accepted/sent: a message already delivered or read stays so.
   *
   * @param {string} providerId - Meta's wamid
   * @param {'sent'|'delivered'|'read'|'failed'} status
   * @param {Date} at
   * @param {string} [errorMessage] - for `failed`
   * @returns {Promise<boolean>} true when a row moved
   */
  async advanceDeliveryStatus(providerId, status, at, errorMessage) {
    let earlier;
    if (status === 'failed') earlier = ['accepted', 'sent'];
    else {
      const rank = DELIVERY_RANK.indexOf(status);
      if (rank < 0) return false;
      earlier = DELIVERY_RANK.slice(0, rank);
    }
    const set = { deliveryStatus: status, deliveryStatusAt: at };
    if (status === 'failed') {
      set.status = 'failed';
      if (errorMessage) set.errorMessage = String(errorMessage).slice(0, 500);
    }
    const res = await NotificationLog.updateOne(
      {
        providerId,
        type: 'whatsapp',
        $or: [{ deliveryStatus: { $in: earlier } }, { deliveryStatus: { $exists: false } }],
      },
      { $set: set },
    );
    return res.modifiedCount === 1;
  }
}

export default new NotificationLogRepository();
