/**
 * How a parcel is shown to whoever is asking.
 *
 * `shipments[].proofPhoto(s)` (the supplier's photos / PDFs uploaded from the team panel) are
 * PRIVATE storage ref — no public URL, and on Cloudinary-era refs a signed one we
 * must not hand out. So:
 *   - admins get `proofPhotoUrl`: the same authorised, staff-only proxy the team
 *     panel uses (/staff/work/.../photo), which streams the bytes after checking
 *     who is asking
 *   - everyone else (the customer's own order pages) never sees the ref at all
 *
 * `trackingSteps` (courier progress from the team panel) carry who recorded them;
 * the customer gets the step, the time and the note — never the staff member.
 */

const idOf = (v) => (v == null ? '' : String(v._id ?? v));

export const proofPhotoPath = (orderId, shipmentId) =>
  `/api/v1/staff/work/orders/${idOf(orderId)}/parcels/${idOf(shipmentId)}/photo`;

/** One proof of a parcel by id (`legacy` = the single proof parcels had before Oct 2026). */
export const proofFilePath = (orderId, shipmentId, photoId) =>
  `${proofPhotoPath(orderId, shipmentId).replace(/\/photo$/, '')}/photos/${encodeURIComponent(String(photoId))}`;

export const LEGACY_PROOF_ID = 'legacy';

/**
 * Every proof on a parcel, oldest first: the legacy single `proofPhoto` (if any),
 * then `proofPhotos`. Each as `{ id, ref }` — `ref` is the private storage ref.
 */
export function parcelProofs(shipment) {
  const out = [];
  if (shipment?.proofPhoto?.publicId) out.push({ id: LEGACY_PROOF_ID, ref: shipment.proofPhoto });
  for (const p of shipment?.proofPhotos || []) if (p?.publicId) out.push({ id: idOf(p._id), ref: p });
  return out;
}

/** One parcel, shaped for the viewer. */
export function shipmentForViewer(shipment, { orderId, isAdmin = false } = {}) {
  if (!shipment || typeof shipment !== 'object') return shipment;
  const { proofPhoto, proofPhotos, stepCount, ...rest } = shipment;
  if (!isAdmin && Array.isArray(rest.trackingSteps)) {
    rest.trackingSteps = rest.trackingSteps.map(({ status, note, at }) => ({ status, ...(note && { note }), at }));
  }
  if (!isAdmin) return rest;
  const proofs = parcelProofs({ proofPhoto, proofPhotos });
  if (!proofs.length) return { ...rest, stepCount };
  return {
    ...rest,
    proofPhotoUrl: proofPhotoPath(orderId, shipment._id), // the first one; kept for older screens
    proofFiles: proofs.map(({ id, ref }) => ({
      id, url: proofFilePath(orderId, shipment._id, id), contentType: ref.contentType || 'image/jpeg', name: ref.name || '',
    })),
    stepCount,
  };
}

/** Every parcel on an order, shaped for the viewer. */
export const shipmentsForViewer = (shipments, opts) =>
  (Array.isArray(shipments) ? shipments.map((s) => shipmentForViewer(s, opts)) : shipments);
