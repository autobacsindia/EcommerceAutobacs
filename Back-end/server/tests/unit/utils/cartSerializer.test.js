import { serializeCart } from '../../../utils/cartSerializer.js';

// Two failure modes matter here, and both are invisible in normal use:
//   • a wrong/absent catalogue id → checkout ad events match no Merchant Center
//     or Meta catalogue offer, so remarketing silently reports nothing;
//   • a leaked wpId → an internal WooCommerce migration id shipped to browsers.

const populatedProduct = (over = {}) => ({
  _id: 'p1',
  name: 'Roof Rack',
  price: 4999,
  wpId: 11466,
  productType: 'simple',
  ...over,
});

describe('serializeCart', () => {
  test('attaches the catalogue id derived from wpId', () => {
    const out = serializeCart({ items: [{ product: populatedProduct(), quantity: 1 }] });
    expect(out.items[0].metaContentId).toBe('11466');
  });

  test('resolves the VARIANT catalogue id when the line has a variantId', () => {
    const product = populatedProduct({
      productType: 'variable',
      variants: [
        { _id: 'v1', wpVariationId: 11469 },
        { _id: 'v2', wpVariationId: 11475 },
      ],
    });

    const out = serializeCart({ items: [{ product, variantId: 'v2', quantity: 1 }] });
    expect(out.items[0].metaContentId).toBe('11475');
  });

  test('never leaks wpId to the client', () => {
    const out = serializeCart({ items: [{ product: populatedProduct(), quantity: 1 }] });

    expect(out.items[0].product).not.toHaveProperty('wpId');
    expect(JSON.stringify(out)).not.toContain('wpId');
    // …while keeping everything the cart UI already renders.
    expect(out.items[0].product).toMatchObject({ _id: 'p1', name: 'Roof Rack', price: 4999 });
  });

  test('keeps variants — cart consumers render variant choices from them', () => {
    const product = populatedProduct({ variants: [{ _id: 'v1', label: 'Petrol', wpVariationId: 1 }] });
    const out = serializeCart({ items: [{ product, quantity: 1 }] });
    expect(out.items[0].product.variants).toHaveLength(1);
  });

  test('an UNpopulated product ref yields a null id, never "ab_undefined"', () => {
    const out = serializeCart({ items: [{ product: 'someObjectId', quantity: 1 }] });
    expect(out.items[0].metaContentId).toBeNull();
  });

  test('converts a Mongoose document via toObject()', () => {
    const doc = {
      toObject: () => ({ items: [{ product: populatedProduct(), quantity: 2 }], total: 9998 }),
    };
    const out = serializeCart(doc);
    expect(out.total).toBe(9998);
    expect(out.items[0].metaContentId).toBe('11466');
  });

  test('passes through empty and missing carts without throwing', () => {
    expect(serializeCart(null)).toBeNull();
    expect(serializeCart({ items: [] }).items).toEqual([]);
    expect(serializeCart({ couponCode: 'X' })).toEqual({ couponCode: 'X' });
  });
});
