/**
 * How a parcel is shown to whoever is asking.
 *
 * `shipments[].proofPhoto` (the supplier's photo uploaded from the team panel) is a
 * PRIVATE storage ref — no public URL, and on Cloudinary-era refs a signed one we
 * must not hand out. So:
 *   - admins get `proofPhotoUrl`: the same authorised, staff-only proxy the team
 *     panel uses (/staff/work/.../photo), which streams the bytes after checking
 *     who is asking
 *   - everyone else (the customer's own order pages) never sees the ref at all
 */

const idOf = (v) => (v == null ? '' : String(v._id ?? v));

export const proofPhotoPath = (orderId, shipmentId) =>
  `/api/v1/staff/work/orders/${idOf(orderId)}/parcels/${idOf(shipmentId)}/photo`;

/** One parcel, shaped for the viewer. */
export function shipmentForViewer(shipment, { orderId, isAdmin = false } = {}) {
  if (!shipment || typeof shipment !== 'object') return shipment;
  const { proofPhoto, ...rest } = shipment;
  return isAdmin && proofPhoto?.publicId
    ? { ...rest, proofPhotoUrl: proofPhotoPath(orderId, shipment._id) }
    : rest;
}

/** Every parcel on an order, shaped for the viewer. */
export const shipmentsForViewer = (shipments, opts) =>
  (Array.isArray(shipments) ? shipments.map((s) => shipmentForViewer(s, opts)) : shipments);
