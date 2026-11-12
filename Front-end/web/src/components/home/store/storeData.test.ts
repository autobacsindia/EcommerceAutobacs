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

describe('getStoreHomeData shelf order (mocked API)', () => {
  const api = (id: string, price: number, extra: Record<string, unknown> = {}) =>
    ({ _id: id, name: id, slug: id, price, brand: '', images: [{ url: `/${id}.jpg` }], stock: 'in', ...extra });
  const calls: string[] = [];

  beforeAll(() => {
    jest.resetModules();
    jest.doMock('@/lib/server-api', () => ({
      serverFetch: async (url: string) => {
        calls.push(url);
        if (url.startsWith('/categories')) return { categories: [] };
        if (url.startsWith('/products/offers')) return {
          total: 3,
          products: [
            api('key', 1620, { originalPrice: 3840 }),
            api('rollbar', 75000, { originalPrice: 136000, stock: 'out' }),
            api('wheel', 95000, { originalPrice: 153000 }),
          ],
        };
        if (url.includes('sortBy=salesScore')) return {
          products: [api('shield', 4200, { salesScore: 6 }), api('winch', 45000, { salesScore: 1 }), api('never', 99000, { salesScore: 0 })],
        };
        if (url.includes('isFeatured=true')) return { products: [api('f-back', 185000, { stock: 'backorder' }), api('f1', 283000)] };
        if (url.includes('sortBy=price')) return { products: [api('d1', 814200, { brand: 'A' }), api('d2', 588499, { brand: 'B' }), api('d3', 500000, { brand: 'C' })] };
        return { products: [] };
      },
    }));
  });
  afterAll(() => jest.dontMock('@/lib/server-api'));

  it('orders deals and best sellers premium-first with unbuyable last, and builds Premium Picks', async () => {
    const { getStoreHomeData } = await import('./storeData');
    const d = await getStoreHomeData();
    expect(d.deals.map((p) => p.id)).toEqual(['wheel', 'key', 'rollbar']);
    expect(d.bestSellers.map((p) => [p.id, p.salesRank])).toEqual([['winch', 2], ['shield', 1]]);
    expect(d.premiumPicks.map((p) => p.id)).toEqual(['f1', 'd1', 'd2', 'd3', 'f-back']);
    // The top-up list is sorted and bounded by the backend, buyable only.
    const dearest = calls.find((u) => u.includes('sortBy=price'))!;
    expect(dearest).toMatch(/inStock=true/);
    expect(dearest).toMatch(/limit=24/);
  });
});
