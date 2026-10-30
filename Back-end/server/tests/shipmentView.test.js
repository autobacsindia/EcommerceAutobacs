/**
 * utils/shipmentView.js — what each viewer sees of a parcel's private proofs.
 * The customer must never get a storage ref; the admin gets authorised links,
 * including for parcels from before Oct 2026 that hold a single `proofPhoto`.
 */
import { shipmentForViewer, parcelProofs } from '../utils/shipmentView.js';

const ORDER = 'o1';
const ref = (publicId, extra = {}) => ({ publicId, provider: 'r2', contentType: 'image/jpeg', bytes: 10, ...extra });
const legacyOnly = { _id: 's1', status: 'shipped', proofPhoto: ref('shipping-slips/proof-old.jpg') };
const both = {
  _id: 's2', status: 'shipped',
  proofPhoto: ref('shipping-slips/proof-old.jpg'),
  proofPhotos: [{ _id: 'a1', ...ref('shipping-slips/proof-a.jpg') }, { _id: 'a2', ...ref('shipping-slips/proof-b.pdf', { contentType: 'application/pdf', name: 'receipt.pdf' }) }],
};

describe('parcelProofs', () => {
  it('lists the legacy photo first (id "legacy"), then the list; skips empty refs', () => {
    expect(parcelProofs(both).map((p) => p.id)).toEqual(['legacy', 'a1', 'a2']);
    expect(parcelProofs({ proofPhoto: {}, proofPhotos: [{ _id: 'x' }] })).toEqual([]);
    expect(parcelProofs(undefined)).toEqual([]);
  });
});

describe('shipmentForViewer', () => {
  it('a customer sees no proof at all — no ref, no link', () => {
    for (const s of [legacyOnly, both]) {
      const out = shipmentForViewer(s, { orderId: ORDER, isAdmin: false });
      expect(JSON.stringify(out)).not.toMatch(/proofPhoto|proofFiles|shipping-slips/);
    }
  });

  it('the admin gets a private link per proof — the old single photo too — and no storage ref', () => {
    const out = shipmentForViewer(both, { orderId: ORDER, isAdmin: true });
    expect(out.proofPhotoUrl).toBe('/api/v1/staff/work/orders/o1/parcels/s2/photo');
    expect(out.proofFiles).toEqual([
      { id: 'legacy', url: '/api/v1/staff/work/orders/o1/parcels/s2/photos/legacy', contentType: 'image/jpeg', name: '' },
      { id: 'a1', url: '/api/v1/staff/work/orders/o1/parcels/s2/photos/a1', contentType: 'image/jpeg', name: '' },
      { id: 'a2', url: '/api/v1/staff/work/orders/o1/parcels/s2/photos/a2', contentType: 'application/pdf', name: 'receipt.pdf' },
    ]);
    expect(JSON.stringify(out)).not.toMatch(/shipping-slips/);
    expect(shipmentForViewer(legacyOnly, { orderId: ORDER, isAdmin: true }).proofFiles).toHaveLength(1);
  });

  it('a parcel with no proof: no links', () => {
    const out = shipmentForViewer({ _id: 's3', status: 'shipped' }, { orderId: ORDER, isAdmin: true });
    expect(out.proofPhotoUrl).toBeUndefined();
    expect(out.proofFiles).toBeUndefined();
  });
});
