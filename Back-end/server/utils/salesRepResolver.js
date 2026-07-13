import mongoose from 'mongoose';
import salesRepRepository from '../repositories/salesRepRepository.js';

/**
 * Resolve a rep id into a SalesRep profile, with a controller-agnostic error
 * shape. Shared by the lead controller and the offline-order controller so the
 * "is this a valid (active) rep?" rule lives in exactly one place.
 *
 * @param {string} repId
 * @param {{requireActive?:boolean}} [opts] requireActive=true (default) rejects a
 *   deactivated rep — correct when ASSIGNING new work. Pass false when merely
 *   CREDITING an action on an already-owned lead (status change / activity log):
 *   the lead's owner may since have been deactivated, and that action must still
 *   be attributable to them rather than 400.
 * @returns {Promise<{rep?:object, error?:{status:number,message:string}}>}
 */
export async function resolveRep(repId, { requireActive = true } = {}) {
  if (!mongoose.isValidObjectId(repId)) {
    return { error: { status: 400, message: 'A valid sales rep is required' } };
  }
  const rep = await salesRepRepository.findById(repId);
  if (!rep) {
    return { error: { status: 400, message: 'Sales rep not found' } };
  }
  if (requireActive && !rep.isActive) {
    return { error: { status: 400, message: 'Sales rep is inactive' } };
  }
  return { rep };
}
