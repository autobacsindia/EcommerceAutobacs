/**
 * Unit tests — utils/variantImage.js
 *
 * The rules the whole per-model image feature rests on:
 *   1. A model with no pointer resolves to the PRODUCT's image, every time, and
 *      that fallback is computed on read so it tracks the product.
 *   2. A pointer at an image that is gone degrades to the same fallback rather
 *      than putting a hole in a live PDP.
 *   3. Composing a save prunes pointers whose target went away, so "is this
 *      asset still referenced?" stays answerable.
 */

import {
  primaryImage,
  resolveVariantImage,
  resolveVariantImageUrl,
  referencedImageKeys,
  pruneDanglingPointers,
  planVariantOwnedCleanup,
} from '../../../utils/variantImage.js';

const img = (id, extra = {}) => ({
  url: `https://img.autobacsindia.com/autobacs/products/${id}.jpg`,
  public_id: id,
  alt: id,
  isPrimary: false,
  ...extra,
});

const product = (images) => ({ images });

describe('primaryImage', () => {
  test('prefers the entry flagged primary over document order', () => {
    const p = product([img('a'), img('b', { isPrimary: true }), img('c')]);
    expect(primaryImage(p).public_id).toBe('b');
  });

  test('falls back to the first entry when nothing is flagged', () => {
    expect(primaryImage(product([img('a'), img('b')])).public_id).toBe('a');
  });

  test('returns null for an empty or absent gallery rather than throwing', () => {
    expect(primaryImage(product([]))).toBeNull();
    expect(primaryImage({})).toBeNull();
    expect(primaryImage(null)).toBeNull();
  });
});

describe('resolveVariantImage', () => {
  const gallery = [img('pack', { isPrimary: true }), img('oncar'), img('smoked'), img('clear')];
  const p = product(gallery);

  test('resolves a model to the gallery entry it points at', () => {
    expect(resolveVariantImage(p, { imageKey: 'smoked' }).public_id).toBe('smoked');
    expect(resolveVariantImage(p, { imageKey: 'clear' }).public_id).toBe('clear');
  });

  test('a model with no pointer falls back to the product primary', () => {
    expect(resolveVariantImage(p, { label: 'no photo yet' }).public_id).toBe('pack');
  });

  test('null/absent variant resolves the product itself', () => {
    expect(resolveVariantImage(p).public_id).toBe('pack');
    expect(resolveVariantImage(p, null).public_id).toBe('pack');
  });

  test('a blank or whitespace pointer is treated as no pointer', () => {
    expect(resolveVariantImage(p, { imageKey: '' }).public_id).toBe('pack');
    expect(resolveVariantImage(p, { imageKey: '   ' }).public_id).toBe('pack');
  });

  test('a pointer at a removed image degrades to the fallback, never null', () => {
    expect(resolveVariantImage(p, { imageKey: 'deleted-yesterday' }).public_id).toBe('pack');
  });

  test('the fallback TRACKS the product — it is resolved, never frozen', () => {
    const variant = { label: 'clear lights' };
    expect(resolveVariantImage(p, variant).public_id).toBe('pack');

    // Admin promotes a different photo to primary. The model followed it with no
    // write of its own; a copied URL would still be pointing at `pack`.
    const repointed = product([img('pack'), img('oncar', { isPrimary: true })]);
    expect(resolveVariantImage(repointed, variant).public_id).toBe('oncar');
  });

  test('returns null only when the product genuinely has no images', () => {
    expect(resolveVariantImage(product([]), { imageKey: 'smoked' })).toBeNull();
  });

  test('legacy entries with no public_id resolve by URL', () => {
    const legacy = { url: 'https://autobacsindia.com/wp-content/a.jpg', isPrimary: true };
    expect(
      resolveVariantImage(product([legacy]), { imageKey: legacy.url }).url
    ).toBe(legacy.url);
  });
});

describe('resolveVariantImageUrl', () => {
  test('returns the url of the resolved entry', () => {
    const p = product([img('pack', { isPrimary: true }), img('smoked')]);
    expect(resolveVariantImageUrl(p, { imageKey: 'smoked' })).toContain('smoked.jpg');
    expect(resolveVariantImageUrl(p, {})).toContain('pack.jpg');
  });

  test('returns null for an imageless product', () => {
    expect(resolveVariantImageUrl(product([]), {})).toBeNull();
  });
});

describe('referencedImageKeys', () => {
  test('collects every key any model points at', () => {
    const p = { variants: [{ imageKey: 'a' }, { imageKey: 'b' }, { label: 'none' }] };
    expect(referencedImageKeys(p)).toEqual(new Set(['a', 'b']));
  });

  test('deduplicates a key shared by several models', () => {
    const p = { variants: [{ imageKey: 'a' }, { imageKey: 'a' }] };
    expect(referencedImageKeys(p)).toEqual(new Set(['a']));
  });

  test('is empty for a simple product', () => {
    expect(referencedImageKeys({ variants: [] })).toEqual(new Set());
    expect(referencedImageKeys({})).toEqual(new Set());
  });
});

describe('pruneDanglingPointers', () => {
  test('keeps pointers whose target survived', () => {
    const out = pruneDanglingPointers([img('a'), img('b')], [{ label: 'x', imageKey: 'b' }]);
    expect(out[0].imageKey).toBe('b');
  });

  test('drops a pointer whose target was removed', () => {
    const out = pruneDanglingPointers([img('a')], [{ label: 'x', imageKey: 'b' }]);
    expect(out[0]).not.toHaveProperty('imageKey');
    expect(out[0].label).toBe('x');
  });

  test('clears every pointer when the gallery is emptied', () => {
    const out = pruneDanglingPointers([], [{ imageKey: 'a' }, { imageKey: 'b' }]);
    expect(out.every((v) => !('imageKey' in v))).toBe(true);
  });

  test('leaves models that never had a pointer untouched', () => {
    const variants = [{ label: 'x' }];
    expect(pruneDanglingPointers([img('a')], variants)[0]).toEqual({ label: 'x' });
  });

  test('does not mutate the input', () => {
    const variants = [{ label: 'x', imageKey: 'gone' }];
    pruneDanglingPointers([], variants);
    expect(variants[0].imageKey).toBe('gone');
  });

  test('resolves legacy no-public_id entries by URL', () => {
    const legacy = { url: 'https://autobacsindia.com/wp-content/a.jpg' };
    const out = pruneDanglingPointers([legacy], [{ imageKey: legacy.url }]);
    expect(out[0].imageKey).toBe(legacy.url);
  });

  test('tolerates junk input rather than throwing', () => {
    expect(pruneDanglingPointers(null, null)).toEqual([]);
    expect(pruneDanglingPointers([img('a')], [null])).toEqual([null]);
  });
});

describe('planVariantOwnedCleanup', () => {
  const owned = (id, extra = {}) => img(id, { variantOwned: true, ...extra });

  test('an image uploaded for a model dies when that model is gone', () => {
    const { survivors, orphaned, changed } = planVariantOwnedCleanup(
      [img('pack', { isPrimary: true }), owned('smoked')],
      [] // the model was deleted
    );
    expect(orphaned.map((i) => i.public_id)).toEqual(['smoked']);
    expect(survivors.map((i) => i.public_id)).toEqual(['pack']);
    expect(changed).toBe(true);
  });

  test('it survives while its model still points at it', () => {
    const { orphaned, changed } = planVariantOwnedCleanup(
      [img('pack', { isPrimary: true }), owned('smoked')],
      [{ label: 'smoked lights', imageKey: 'smoked' }]
    );
    expect(orphaned).toEqual([]);
    expect(changed).toBe(false);
  });

  test('SAFETY VALVE 1 — shared image survives until the LAST model goes', () => {
    const gallery = [img('pack', { isPrimary: true }), owned('shared')];

    // Two models point at it; one is deleted.
    expect(
      planVariantOwnedCleanup(gallery, [{ imageKey: 'shared' }]).orphaned
    ).toEqual([]);

    // The second one goes too — now it is genuinely unreachable.
    expect(
      planVariantOwnedCleanup(gallery, []).orphaned.map((i) => i.public_id)
    ).toEqual(['shared']);
  });

  test('SAFETY VALVE 2 — a model photo promoted to primary is adopted, not deleted', () => {
    const { survivors, orphaned } = planVariantOwnedCleanup(
      [owned('smoked', { isPrimary: true })],
      []
    );
    expect(orphaned).toEqual([]);
    expect(survivors).toHaveLength(1);
    // Demoted to an ordinary gallery photo so it is never reconsidered.
    expect(survivors[0].variantOwned).toBe(false);
    expect(survivors[0].isPrimary).toBe(true);
  });

  test('an ordinary gallery photo is NEVER deleted, whatever models do', () => {
    const { survivors, orphaned } = planVariantOwnedCleanup(
      [img('pack', { isPrimary: true }), img('lifestyle'), img('closeup')],
      []
    );
    expect(orphaned).toEqual([]);
    expect(survivors).toHaveLength(3);
  });

  test('re-pointing a model frees the photo it abandoned', () => {
    const { orphaned } = planVariantOwnedCleanup(
      [img('pack', { isPrimary: true }), owned('smoked'), owned('clear')],
      [{ label: 'x', imageKey: 'clear' }] // was pointing at 'smoked'
    );
    expect(orphaned.map((i) => i.public_id)).toEqual(['smoked']);
  });

  test('switching variable → simple frees every model photo at once', () => {
    const { survivors, orphaned } = planVariantOwnedCleanup(
      [img('pack', { isPrimary: true }), owned('a'), owned('b'), owned('c')],
      [] // the derivation hook cleared variants
    );
    expect(orphaned.map((i) => i.public_id)).toEqual(['a', 'b', 'c']);
    expect(survivors.map((i) => i.public_id)).toEqual(['pack']);
  });

  test('orphaned refs keep their url — the store cannot be inferred from the id', () => {
    const { orphaned } = planVariantOwnedCleanup([owned('smoked')], []);
    expect(orphaned[0]).toMatchObject({
      public_id: 'smoked',
      url: expect.stringContaining('img.autobacsindia.com'),
    });
  });

  test('preserves gallery order among survivors', () => {
    const { survivors } = planVariantOwnedCleanup(
      [img('a', { isPrimary: true }), owned('gone'), img('b'), img('c')],
      []
    );
    expect(survivors.map((i) => i.public_id)).toEqual(['a', 'b', 'c']);
  });

  test('does not mutate the input gallery', () => {
    const gallery = [owned('smoked', { isPrimary: true })];
    planVariantOwnedCleanup(gallery, []);
    expect(gallery[0].variantOwned).toBe(true);
  });

  test('tolerates junk input rather than throwing', () => {
    expect(planVariantOwnedCleanup(null, null)).toEqual({
      survivors: [], orphaned: [], changed: false,
    });
  });
});
