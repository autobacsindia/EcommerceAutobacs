/**
 * Unit tests — Product.variants[].imageKey (the per-model image pointer).
 *
 * Two properties are pinned here, both of which have cost this project before:
 *
 *  1. NO PHANTOM SUBDOCUMENT. `imageKey` carries no `default`, so a model that
 *     was never given a photo must persist with the field genuinely ABSENT.
 *     A default on a nested path materialises an empty subdoc on every row —
 *     the exact defect behind the phantom order return/refund subdocs that
 *     needed a production cleanup migration. "Absent" is what the read-time
 *     fallback keys off; if every variant carries a value, the fallback dies.
 *
 *  2. IT IS A POINTER, NOT AN IMAGE. It holds a gallery entry's key, so the
 *     asset keeps exactly one owner and therefore one place it can be deleted.
 *     Storing {url, public_id} here would give a model its own asset to orphan.
 */
const { default: Product } = await import('../../../models/Product.js');

const R2 = 'https://img.autobacsindia.com/autobacs/products';

const variableProduct = (variants, images = [
  { url: `${R2}/pack.jpg`, public_id: 'pack', isPrimary: true },
  { url: `${R2}/smoked.jpg`, public_id: 'smoked' },
]) => new Product({
  name: 'Wrangler Style LED Tail Lights',
  slug: `tail-${Math.random().toString(36).slice(2)}`,
  description: 'd',
  productType: 'variable',
  images,
  variants,
});

describe('variants[].imageKey — absence must survive a save', () => {
  test('a model with no photo persists with imageKey ABSENT, not empty', async () => {
    const p = variableProduct([{ label: 'clear lights', price: 100 }]);
    await p.validate();

    const v = p.variants[0];
    expect(v.imageKey).toBeUndefined();
    // The serialized form is what reaches Mongo — a phantom would show up here.
    expect(Object.prototype.hasOwnProperty.call(v.toObject(), 'imageKey')).toBe(false);
  });

  test('no variant gains a pointer just because a sibling has one', async () => {
    const p = variableProduct([
      { label: 'smoked lights', price: 100, imageKey: 'smoked' },
      { label: 'clear lights', price: 90 },
    ]);
    await p.validate();

    expect(p.variants[0].imageKey).toBe('smoked');
    expect(p.variants[1].imageKey).toBeUndefined();
  });
});

describe('variants[].imageKey — shape', () => {
  test('stores the gallery entry key verbatim', async () => {
    const p = variableProduct([{ label: 'smoked lights', price: 100, imageKey: 'smoked' }]);
    await p.validate();
    expect(p.variants[0].imageKey).toBe('smoked');
  });

  test('trims incidental whitespace so lookups match', async () => {
    const p = variableProduct([{ label: 'smoked lights', price: 100, imageKey: '  smoked  ' }]);
    await p.validate();
    expect(p.variants[0].imageKey).toBe('smoked');
  });

  test('accepts a full URL, for migrated rows with no public_id', async () => {
    const legacy = 'https://autobacsindia.com/wp-content/uploads/2025/05/a.jpg';
    const p = variableProduct(
      [{ label: 'old model', price: 100, imageKey: legacy }],
      [{ url: legacy, isPrimary: true }]
    );
    await p.validate();
    expect(p.variants[0].imageKey).toBe(legacy);
  });

  test('a pointer at an image not in the gallery still VALIDATES — reads fall back', async () => {
    // Referential integrity is enforced by the write path, not the schema: a
    // stale key must never be able to block a save (or a concurrent gallery edit
    // could make a product unsaveable), and reads degrade to the product image.
    const p = variableProduct([{ label: 'x', price: 100, imageKey: 'deleted-yesterday' }]);
    await expect(p.validate()).resolves.toBeUndefined();
  });
});

describe('variants[].imageKey — interaction with the derivation hook', () => {
  test('switching to a simple product clears variants and their pointers', async () => {
    const p = variableProduct([{ label: 'smoked lights', price: 100, imageKey: 'smoked' }]);
    await p.validate();
    expect(p.variants).toHaveLength(1);

    p.productType = 'simple';
    p.price = 100;
    await p.validate();
    expect(p.variants).toHaveLength(0);
  });

  test('the pointer does not disturb price/stock aggregation', async () => {
    const p = variableProduct([
      { label: 'smoked lights', price: 12500, imageKey: 'smoked', stock: 'in' },
      { label: 'clear lights', price: 11900, stock: 'out' },
    ]);
    await p.validate();
    expect(p.priceMin).toBe(11900);
    expect(p.priceMax).toBe(12500);
    expect(p.price).toBe(11900);
    expect(p.stock).toBe('in');
  });
});
