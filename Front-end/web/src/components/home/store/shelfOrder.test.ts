import { buildPremiumPicks, isBuyable, orderShelf, spreadBrands } from './shelfOrder';
import { toStoreProduct, type StoreProduct } from './storeData';

const prod = (id: string, price: number, over: Partial<StoreProduct> = {}): StoreProduct => ({
  id, name: id, href: `/products/${id}`, image: `/${id}.jpg`, brand: '', price, rating: 0, reviews: 0, stock: 'in', ...over,
});
const ids = (ps: StoreProduct[]) => ps.map((p) => p.id);

describe('isBuyable', () => {
  it('treats in/low as buyable and out/backorder as not', () => {
    expect(isBuyable({ stock: 'in' })).toBe(true);
    expect(isBuyable({ stock: 'low' })).toBe(true);
    expect(isBuyable({ stock: 'out' })).toBe(false);
    expect(isBuyable({ stock: 'backorder' })).toBe(false);
  });
});

describe('orderShelf premium', () => {
  it('puts the dearest first', () => {
    expect(ids(orderShelf([prod('a', 4200), prod('b', 45000), prod('c', 19990)], 'premium'))).toEqual(['b', 'c', 'a']);
  });

  it('sinks out-of-stock and backorder below every buyable item, however dear', () => {
    const out = orderShelf([
      prod('cheap', 1000), prod('outDear', 900000, { stock: 'out' }), prod('low', 5000, { stock: 'low' }),
      prod('backDear', 185000, { stock: 'backorder' }),
    ], 'premium');
    expect(ids(out)).toEqual(['low', 'cheap', 'outDear', 'backDear']);
  });

  it('keeps the source order on equal prices (stable ties), every run', () => {
    const input = [prod('x', 500), prod('y', 900), prod('z', 500), prod('w', 500)];
    for (let i = 0; i < 5; i++) expect(ids(orderShelf(input, 'premium'))).toEqual(['y', 'x', 'z', 'w']);
  });

  it('does not mutate its input', () => {
    const input = [prod('a', 1), prod('b', 2)];
    orderShelf(input, 'premium');
    expect(ids(input)).toEqual(['a', 'b']);
  });

  it('handles an empty shelf', () => {
    expect(orderShelf([], 'premium')).toEqual([]);
  });
});

describe('orderShelf source', () => {
  it('keeps upstream ranking but still sinks unbuyable items', () => {
    expect(ids(orderShelf([prod('a', 1), prod('b', 9, { stock: 'out' }), prod('c', 5)], 'source'))).toEqual(['a', 'c', 'b']);
  });
});

describe('spreadBrands', () => {
  it('avoids two neighbours of one brand when another brand can go between', () => {
    const out = spreadBrands([
      prod('o1', 5, { brand: 'OME' }), prod('o2', 4, { brand: 'OME' }), prod('i1', 3, { brand: 'Ironman' }), prod('o3', 2, { brand: 'OME' }),
    ]);
    expect(ids(out)).toEqual(['o1', 'i1', 'o2', 'o3']);
  });

  it('is case-insensitive and ignores products with no brand', () => {
    expect(ids(spreadBrands([prod('a', 3, { brand: 'BMC' }), prod('b', 2, { brand: 'bmc ' }), prod('c', 1, { brand: 'X' })])))
      .toEqual(['a', 'c', 'b']);
    expect(ids(spreadBrands([prod('a', 3), prod('b', 2), prod('c', 1, { brand: 'X' })]))).toEqual(['a', 'b', 'c']);
  });

  it('never pulls an unbuyable item above a buyable one', () => {
    const out = spreadBrands([prod('a', 3, { brand: 'B' }), prod('b', 2, { brand: 'B' }), prod('c', 9, { brand: 'C', stock: 'out' })]);
    expect(ids(out)).toEqual(['a', 'b', 'c']);
  });
});

describe('buildPremiumPicks', () => {
  const cfg = { size: 5, perBrand: 2, minSize: 2 };

  it('puts buyable featured first, then dearest top-ups, then featured on backorder', () => {
    const featured = [prod('f-cheap', 8300), prod('f-back', 185000, { stock: 'backorder' }), prod('f-dear', 283000)];
    const dearest = [prod('d1', 814200, { brand: 'A' }), prod('d2', 588499, { brand: 'B' })];
    expect(ids(buildPremiumPicks(featured, dearest, cfg))).toEqual(['f-dear', 'f-cheap', 'd1', 'd2', 'f-back']);
  });

  it('caps top-ups at perBrand per brand (counting featured) and skips duplicates and unbuyable', () => {
    const featured = [prod('f1', 300000, { brand: 'Profender' })];
    const dearest = [
      prod('f1', 300000, { brand: 'Profender' }), prod('p2', 290000, { brand: 'Profender' }), prod('p3', 280000, { brand: 'profender' }),
      prod('o1', 270000, { brand: 'OME', stock: 'out' }), prod('k1', 100000, { brand: 'Kit' }),
    ];
    expect(ids(buildPremiumPicks(featured, dearest, cfg))).toEqual(['f1', 'k1', 'p2']);
  });

  it('never drops an admin-featured product for the brand cap', () => {
    const featured = [prod('a', 3, { brand: 'X' }), prod('b', 2, { brand: 'X' }), prod('c', 1, { brand: 'X' })];
    expect(ids(buildPremiumPicks(featured, [], cfg))).toHaveLength(3);
  });

  it('stops at size', () => {
    const dearest = Array.from({ length: 10 }, (_, i) => prod(`d${i}`, 1000 - i));
    expect(buildPremiumPicks([], dearest, cfg)).toHaveLength(5);
  });

  it('returns nothing below minSize so a half-empty row is not shown', () => {
    expect(buildPremiumPicks([prod('only', 1)], [], cfg)).toEqual([]);
    expect(buildPremiumPicks([], [], cfg)).toEqual([]);
  });
});

describe('price used for ordering', () => {
  it('is the listed price (multi-model = from/cheapest price), not MRP or the Diwali offer', () => {
    // Backend keeps parent price = cheapest model; MRP (originalPrice) must not lift a product.
    const variable = toStoreProduct({ _id: 'v', name: 'v', price: 6999, originalPrice: 99999, productType: 'variable', images: [{ url: '/v.jpg' }] });
    const simple = toStoreProduct({ _id: 's', name: 's', price: 8000, images: [{ url: '/s.jpg' }] });
    expect(ids(orderShelf([variable, simple], 'premium'))).toEqual(['s', 'v']);
  });

  it('maps stock from the API, defaulting a missing status to in', () => {
    expect(toStoreProduct({ _id: '1', name: 'n', price: 1, stock: 'backorder' }).stock).toBe('backorder');
    expect(toStoreProduct({ _id: '1', name: 'n', price: 1 }).stock).toBe('in');
  });
});
