import { mapVariationsToVariants, aggregateFromVariants } from '../../../utils/wcVariants.js';

// Shaped like GET /products/{id}/variations (WooCommerce).
const wcVariations = [
  { id: 19649, sku: '', price: '7299', regular_price: '7299', sale_price: '', stock_status: 'instock',
    attributes: [{ name: 'models', option: 'GLANZA 1.2' }] },
  { id: 19651, sku: 'BMC-INV', price: '9000', regular_price: '10499', sale_price: '9000', stock_status: 'instock',
    attributes: [{ name: 'models', option: 'INNOVA &amp; FORTUNER 2.5/3.0' }] },
  { id: 19656, sku: '', price: '8299', regular_price: '8299', sale_price: '', stock_status: 'outofstock',
    attributes: [{ name: 'models', option: 'CAMRY 2.5' }] },
];

describe('mapVariationsToVariants', () => {
  const variants = mapVariationsToVariants(wcVariations);

  test('maps id, label, price, stock and decodes entities', () => {
    expect(variants).toHaveLength(3);
    expect(variants[0]).toMatchObject({ wpVariationId: 19649, label: 'GLANZA 1.2', price: 7299, stock: 'in' });
    // &amp; decoded in the label
    expect(variants[1].label).toBe('INNOVA & FORTUNER 2.5/3.0');
  });

  test('on-sale variant carries originalPrice + salePrice', () => {
    expect(variants[1].price).toBe(9000);        // charged price = sale
    expect(variants[1].originalPrice).toBe(10499); // slashed "was"
    expect(variants[1].salePrice).toBe(9000);
    expect(variants[1].sku).toBe('BMC-INV');
  });

  test('non-sale variant has null originalPrice (clears stale badge)', () => {
    expect(variants[0].originalPrice).toBeNull();
    expect(variants[0].salePrice).toBeUndefined();
  });

  test('out-of-stock variation maps to stock "out"', () => {
    expect(variants[2].stock).toBe('out');
  });
});

describe('aggregateFromVariants', () => {
  test('derives priceMin/priceMax, parent price=min, and stock from purchasable variants', () => {
    const variants = mapVariationsToVariants(wcVariations);
    const agg = aggregateFromVariants(variants);
    expect(agg.priceMin).toBe(7299);
    expect(agg.priceMax).toBe(9000);        // dearest CHARGED price
    expect(agg.price).toBe(7299);           // parent mirrors the cheapest
    expect(agg.stock).toBe('in');           // at least one in-stock variant
  });

  test('all-out-of-stock → parent stock out', () => {
    const agg = aggregateFromVariants([{ price: 100, stock: 'out' }, { price: 200, stock: 'out' }]);
    expect(agg.stock).toBe('out');
  });
});
