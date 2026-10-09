import { toStoreProduct, discountPct } from './storeData';

const base = { _id: '1', name: 'Kit', slug: 'kit', price: 800, images: [{ url: '/k.jpg' }] };

describe('toStoreProduct', () => {
  it('keeps the MRP only for a genuine, still-running sale', () => {
    expect(toStoreProduct({ ...base, originalPrice: 1000 }).originalPrice).toBe(1000);
    expect(toStoreProduct({ ...base, originalPrice: 700 }).originalPrice).toBeUndefined(); // MRP below price
    const ended = new Date(Date.now() - 60_000).toISOString();
    expect(toStoreProduct({ ...base, originalPrice: 1000, offerEndDate: ended }).originalPrice).toBeUndefined();
    const running = new Date(Date.now() + 86_400_000).toISOString();
    expect(toStoreProduct({ ...base, originalPrice: 1000, offerEndDate: running }).offerEndDate).toBe(running);
  });

  it('links by slug and picks the primary image', () => {
    const p = toStoreProduct({ ...base, images: [{ url: '/a.jpg' }, { url: '/b.jpg', isPrimary: true }] });
    expect(p.href).toBe('/products/kit');
    expect(p.image).toBe('/b.jpg');
  });
});

describe('discountPct', () => {
  it('is the rounded real saving, or 0', () => {
    expect(discountPct({ price: 600, originalPrice: 1000 })).toBe(40);
    expect(discountPct({ price: 1000 })).toBe(0);
    expect(discountPct({ price: 1000, originalPrice: 900 })).toBe(0);
  });
});
