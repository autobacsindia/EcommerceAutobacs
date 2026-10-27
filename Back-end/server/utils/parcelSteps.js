/**
 * Courier progress on a parcel in transit — what operations records from the team
 * panel between "Dispatched" and "Delivered". Pure constants.
 *
 * "Delivered" is deliberately NOT a step: it is shipmentService.markShipmentDelivered,
 * which emails the customer, awards points, opens the return window and rolls the
 * order up. A step only describes the journey; it never moves the order.
 */

export const PARCEL_STEP = Object.freeze({
  PICKED_UP: 'picked_up',
  IN_TRANSIT: 'in_transit',
  OUT_FOR_DELIVERY: 'out_for_delivery',
  DELIVERY_FAILED: 'delivery_failed',
});

export const PARCEL_STEP_VALUES = Object.freeze(Object.values(PARCEL_STEP));

/** How the team reads each step. */
export const PARCEL_STEP_LABELS = Object.freeze({
  [PARCEL_STEP.PICKED_UP]: 'Picked up',
  [PARCEL_STEP.IN_TRANSIT]: 'In transit',
  [PARCEL_STEP.OUT_FOR_DELIVERY]: 'Out for delivery',
  [PARCEL_STEP.DELIVERY_FAILED]: 'Delivery failed',
});

/** The order-level tracking timeline (Order.trackingEvents, the /track page) uses its own status names. */
export const TRACKING_EVENT_STATUS = Object.freeze({
  [PARCEL_STEP.PICKED_UP]: 'picked_up',
  [PARCEL_STEP.IN_TRANSIT]: 'in_transit',
  [PARCEL_STEP.OUT_FOR_DELIVERY]: 'out_for_delivery',
  [PARCEL_STEP.DELIVERY_FAILED]: 'failed_delivery',
});

/** Newest steps kept per parcel; older ones drop off. */
export const MAX_PARCEL_STEPS = 30;
export const MAX_STEP_NOTE = 120;
