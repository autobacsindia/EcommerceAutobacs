/**
 * Order reads/writes for the courier tracking sync (services/courier/courierSyncService.js).
 * Every write targets `shipments[].courierSync` of ONE parcel and is conditional, so a
 * parcel staff just delivered / wrote off is never touched by the sync.
 */
import Order from '../models/Order.js';

const PROJECTION = {
  createdAt: 1,
  'workflow.enteredAt': 1,
  'shipments._id': 1,
  'shipments.sequence': 1,
  'shipments.status': 1,
  'shipments.trackingNumber': 1,
  'shipments.carrier': 1,
  'shipments.shippedAt': 1,
  'shipments.courierSync': 1,
};

const courierSyncRepository = {
  /**
   * Keyset page (createdAt, _id ascending) of orders with a parcel in transit.
   * Any order with a `shipped` parcel rolls up to `status: 'shipped'`, so the
   * {status:1, createdAt:-1} index narrows this to the small in-transit set.
   */
  async findInTransitPage(after, pageSize) {
    const filter = { status: 'shipped', 'shipments.status': 'shipped' };
    if (after) {
      filter.$or = [
        { createdAt: { $gt: after.createdAt } },
        { createdAt: after.createdAt, _id: { $gt: after._id } },
      ];
    }
    return Order.find(filter, PROJECTION).sort({ createdAt: 1, _id: 1 }).limit(pageSize).lean();
  },

  /** Record a courier check on a parcel that is still in transit. */
  async recordCheck(orderId, shipmentId, set, noMovementSince) {
    const $set = {};
    for (const [k, v] of Object.entries(set)) $set[`shipments.$.courierSync.${k}`] = v;
    const update = { $set };
    if (noMovementSince) $set['shipments.$.courierSync.noMovementSince'] = noMovementSince;
    else update.$unset = { 'shipments.$.courierSync.noMovementSince': '' };
    return Order.updateOne(
      { _id: orderId, shipments: { $elemMatch: { _id: shipmentId, status: 'shipped' } } },
      update,
    );
  },

  /** Once-only claim: true when THIS call set deliveredByCourierAt. */
  async claimCourierDelivery(orderId, shipmentId, at) {
    const r = await Order.updateOne(
      { _id: orderId, shipments: { $elemMatch: { _id: shipmentId, status: 'shipped', 'courierSync.deliveredByCourierAt': null } } },
      { $set: { 'shipments.$.courierSync.deliveredByCourierAt': at } },
    );
    return r.modifiedCount === 1;
  },

  /** Release a claim — only the one this caller made (matched on its timestamp). */
  async releaseCourierDelivery(orderId, shipmentId, at) {
    return Order.updateOne(
      { _id: orderId, shipments: { $elemMatch: { _id: shipmentId, 'courierSync.deliveredByCourierAt': at } } },
      { $unset: { 'shipments.$.courierSync.deliveredByCourierAt': '' } },
    );
  },
};

export default courierSyncRepository;
