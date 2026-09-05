/**
 * Unit tests — the per-model image reaching the ad feeds and the order record.
 *
 * Both used to ship the PARENT product's primary photo for every model:
 *   • the feeds sell each model as a separate offer, so the ad showed blue and
 *     the landing page showed yellow — wasted spend, and the shape that draws
 *     Merchant Center "image mismatch" disapprovals;
 *   • the order line is an immutable record a customer, an invoice and a picker
 *     all read, and it showed the wrong colour on every variable purchase.
 */
import { buildItemsForProduct as metaItems } from '../../../services/metaFeedService.js';
import { buildItemsForProduct as googleItems } from '../../../services/googleFeedService.js';

const R2 = 'https://img.autobacsindia.com/autobacs/products';
const img = (id, extra = {}) => ({ url: `${R2}/${id}.jpg`, public_id: id, alt: id, ...extra });

const variableProduct = () => ({
  _id: '60f0000000000000000000a1',
  name: 'Wrangler Style LED Tail Lights',
  slug: 'wrangler-tail-lights',
  description: 'd',
  brand: 'Autobacs',
  productType: 'variable',
  price: 11900,
  images: [img('pack', { isPrimary: true }), img('smoked', { variantOwned: true })],
  variants: [
    { _id: '60f0000000000000000000b1', label: 'smoked lights', price: 12500, stock: 'in', imageKey: 'smoked' },
    { _id: '60f0000000000000000000b2', label: 'clear lights', price: 11900, stock: 'in' },
  ],
});

const opts = { siteUrl: 'https://autobacsindia.com', defaultBrand: 'Autobacs' };

describe.each([['Meta', metaItems], ['Google', googleItems]])('%s feed images', (_name, build) => {
  test('a model with its own photo advertises THAT photo', () => {
    const rows = build(variableProduct(), opts);
    const smoked = rows.find((r) => r.title.includes('smoked'));
    expect(smoked.image).toContain('smoked.jpg');
  });

  test('a model with no photo falls back to the product image — what its PDP shows', () => {
    const rows = build(variableProduct(), opts);
    const clear = rows.find((r) => r.title.includes('clear'));
    expect(clear.image).toContain('pack.jpg');
  });

  test('models are no longer forced to share one image', () => {
    const rows = build(variableProduct(), opts);
    expect(new Set(rows.map((r) => r.image)).size).toBe(2);
  });

  test('every row still has an image — an offer without one is rejected outright', () => {
    expect(build(variableProduct(), opts).every((r) => Boolean(r.image))).toBe(true);
  });

  test('a simple product is unaffected', () => {
    const simple = { ...variableProduct(), productType: 'simple', variants: [] };
    const rows = build(simple, opts);
    expect(rows).toHaveLength(1);
    expect(rows[0].image).toContain('pack.jpg');
  });

  test('a pointer at a removed image degrades to the product image, never blank', () => {
    const p = variableProduct();
    p.variants[0].imageKey = 'deleted-yesterday';
    const rows = build(p, opts);
    expect(rows.find((r) => r.title.includes('smoked')).image).toContain('pack.jpg');
  });
});
