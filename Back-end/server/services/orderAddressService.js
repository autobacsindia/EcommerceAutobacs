/**
 * Correcting the delivery address on a placed order — admin only, before dispatch.
 *
 * An order is an immutable financial record, so this is deliberately narrow:
 *
 *   • Only contact and street fields change: name, phone, alternate phone,
 *     address lines, city. PIN code, state and country are LOCKED, because the
 *     PIN sets the delivery charge (remote-area fee, distance band) that the
 *     customer already paid. Changing it would silently disagree with the money.
 *     A wrong PIN is a cancel-and-reorder (or an extra charge), not an edit.
 *   • Only while nothing has left the building: order status is awaiting_payment
 *     or processing, no parcel is past `packed`, and no tracking number exists on
 *     the order or any parcel. A courier label already printed carries the old
 *     address, so editing after that would only make the record lie.
 *   • A reason is required, and every change is kept on the order itself
 *     (`addressChanges`, capped) plus the audit log.
 *
 * The lock is enforced inside the update filter, not by a read-then-write check,
 * so an admin dispatching the parcel at the same moment cannot slip past it.
 */

import mongoose from 'mongoose';
import orderRepository from '../repositories/orderRepository.js';
import AppError from '../utils/AppError.js';
import auditLogger from './auditLogger.js';
import { normalisePhone } from '../utils/addressBook.js';

export const ADDRESS_EDITABLE_STATUSES = Object.freeze(['awaiting_payment', 'processing']);
export const EDITABLE_ADDRESS_FIELDS = Object.freeze(['fullName', 'phone', 'alternatePhone', 'addressLine1', 'addressLine2', 'city']);
export const LOCKED_ADDRESS_FIELDS = Object.freeze(['postalCode', 'state', 'country']);
export const MAX_ADDRESS_CHANGES = 20;
const MAX_FIELD = 200;
const MIN_REASON = 3;
const MAX_REASON = 300;

const fail = (message, status = 400) => new AppError(message, status, { expose: true });

const LABELS = {
  fullName: 'Full name', phone: 'Mobile number', alternatePhone: 'Alternate number',
  addressLine1: 'Address line 1', addressLine2: 'Address line 2', city: 'City',
  postalCode: 'PIN code', state: 'State', country: 'Country',
};

/** A parcel that has left (or is labelled to leave) locks the address. */
const SHIPPED_PARCEL = { $or: [{ status: { $ne: 'packed' } }, { trackingNumber: { $nin: [null, ''] } }] };

/** The Mongo filter that makes an order's address editable — reused by the read-side flag. */
export const editableFilter = (orderId) => ({
  _id: orderId,
  status: { $in: ADDRESS_EDITABLE_STATUSES },
  trackingNumber: { $in: [null, ''] },
  shipments: { $not: { $elemMatch: SHIPPED_PARCEL } },
});

/**
 * Pure: may this (lean) order's address be edited? Mirrors `editableFilter` so the
 * UI can hide the button; the filter stays the authority.
 */
export function isAddressEditable(order) {
  if (!order || !ADDRESS_EDITABLE_STATUSES.includes(order.status)) return false;
  if (order.trackingNumber) return false;
  return !(order.shipments || []).some((s) => s.status !== 'packed' || Boolean(s.trackingNumber));
}

/** Why the address is locked, in words the admin can act on. */
function lockedReason(order) {
  if (order.status === 'cancelled') return 'This order is cancelled, so its address can no longer be changed.';
  if (!ADDRESS_EDITABLE_STATUSES.includes(order.status)) {
    return 'This order has already been shipped, so its address can no longer be changed.';
  }
  return 'A parcel on this order has been shipped or has a tracking number, so its address can no longer be changed.';
}

const clean = (v) => String(v ?? '').trim();

/**
 * Pure: validate the requested address against the current one.
 * @returns {object} the full new shippingAddress (locked fields copied from current)
 * @throws {AppError} 400 on any invalid or locked-field change
 */
export function buildNewAddress(current, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('Send the address to save.');
  const cur = current || {};

  for (const f of LOCKED_ADDRESS_FIELDS) {
    if (input[f] !== undefined && clean(input[f]) !== clean(cur[f] ?? (f === 'country' ? 'India' : ''))) {
      throw fail(`${LABELS[f]} can't be changed on a placed order — it sets the delivery charge. Cancel and re-order instead.`);
    }
  }

  const next = { ...cur };
  for (const f of EDITABLE_ADDRESS_FIELDS) {
    if (input[f] === undefined) continue;
    const v = clean(input[f]);
    if (v.length > MAX_FIELD) throw fail(`${LABELS[f]} is too long.`);
    next[f] = v;
  }

  for (const f of ['fullName', 'phone', 'addressLine1', 'city']) {
    if (!clean(next[f])) throw fail(`${LABELS[f]} is required.`);
  }
  const phone = normalisePhone(next.phone);
  if (!phone) throw fail('Mobile number must be a 10-digit Indian mobile number.');
  next.phone = phone;

  if (clean(next.alternatePhone)) {
    const alt = normalisePhone(next.alternatePhone);
    if (!alt) throw fail('Alternate number must be a 10-digit Indian mobile number.');
    next.alternatePhone = alt === phone ? '' : alt;
  }
  if (!next.alternatePhone) delete next.alternatePhone;
  if (!next.addressLine2) next.addressLine2 = '';

  return next;
}

const pick = (a = {}) => Object.fromEntries(
  [...EDITABLE_ADDRESS_FIELDS, ...LOCKED_ADDRESS_FIELDS].filter((f) => a[f] !== undefined && a[f] !== null).map((f) => [f, a[f]]),
);

/** Filter clauses matching the editable fields exactly as they were read. */
const pinCurrentAddress = (a = {}) => Object.fromEntries(EDITABLE_ADDRESS_FIELDS.map((f) => [
  `shippingAddress.${f}`,
  a?.[f] === undefined || a?.[f] === null || a?.[f] === '' ? { $in: [null, ''] } : a[f],
]));

const sameAddress =(a, b) => EDITABLE_ADDRESS_FIELDS.every((f) => clean(a?.[f]) === clean(b?.[f]));

/**
 * Save a corrected delivery address.
 * @param {object} req      Express request (req.user is the admin; used for the audit row)
 * @param {string} orderId
 * @param {{ address: object, reason: string }} body
 * @returns {Promise<{ shippingAddress: object, addressChanges: object[], addressEditable: boolean }>}
 */
export async function updateShippingAddress(req, orderId, body = {}) {
  if (!mongoose.isValidObjectId(orderId)) throw fail('Order not found.', 404);
  const reason = clean(body.reason);
  if (reason.length < MIN_REASON) throw fail('Say why the address is being changed.');
  if (reason.length > MAX_REASON) throw fail(`Keep the reason under ${MAX_REASON} characters.`);

  const order = await orderRepository.findForAddressEdit(orderId);
  if (!order) throw fail('Order not found.', 404);
  if (!isAddressEditable(order)) throw fail(lockedReason(order), 409);

  const next = buildNewAddress(order.shippingAddress, body.address);
  if (sameAddress(order.shippingAddress, next)) throw fail('Nothing changed.');

  const change = {
    at: new Date(),
    by: req.user?._id ?? null,
    byName: req.user?.name || req.user?.email || '',
    reason,
    before: pick(order.shippingAddress),
    after: pick(next),
  };

  const updated = await orderRepository.applyAddressEdit(
    // Also pin the address we validated against: a second admin saving at the same
    // moment fails loudly instead of having their edit silently overwritten.
    { ...editableFilter(order._id), ...pinCurrentAddress(order.shippingAddress) },
    { $set: { shippingAddress: next }, $push: { addressChanges: { $each: [change], $slice: -MAX_ADDRESS_CHANGES } } },
  );

  if (!updated) {
    // Lost the race: re-read to tell the admin which way.
    const now = await orderRepository.findForAddressEdit(orderId);
    if (now && !isAddressEditable(now)) throw fail(lockedReason(now), 409);
    throw fail('Someone else just changed this address. Reload and try again.', 409);
  }

  await auditLogger.logAction(req, 'UPDATE', 'OrderShippingAddress', String(order._id), {
    reason, before: change.before, after: change.after,
  });

  return {
    shippingAddress: updated.shippingAddress,
    addressChanges: updated.addressChanges || [],
    addressEditable: isAddressEditable(updated),
  };
}

export default { updateShippingAddress, isAddressEditable, buildNewAddress, editableFilter };
