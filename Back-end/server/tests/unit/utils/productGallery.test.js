/**
 * Unit tests — utils/productGallery.js
 *
 * These cover the two rules the whole image pipeline rests on:
 *   1. A non-empty gallery always has exactly one primary.
 *   2. An image is only ever removed on positive confirmation, never on
 *      "we could not check it" — the difference between cleaning up a dead row
 *      and deleting a live product's entire gallery.
 */

import { imageKey, orderGallery, planGalleryCleanup } from '../../../utils/productGallery.js';

const img = (id, extra = {}) => ({
  url: `https://res.cloudinary.com/c/${id}.jpg`,
  public_id: id,
  alt: id,
  isPrimary: false,
  ...extra,
});

describe('imageKey', () => {
  test('prefers public_id', () => {
    expect(imageKey({ public_id: 'pid', url: 'https://x/y.jpg' })).toBe('pid');
  });

  test('falls back to URL for migrated images with no public_id', () => {
    expect(imageKey({ url: 'https://autobacsindia.com/wp-content/a.jpg' }))
      .toBe('https://autobacsindia.com/wp-content/a.jpg');
  });

  test('returns empty string for junk rather than throwing', () => {
    expect(imageKey(null)).toBe('');
    expect(imageKey({})).toBe('');
  });
});

describe('orderGallery', () => {
  test('applies the requested order', () => {
    const out = orderGallery([img('a'), img('b'), img('c')], ['c', 'a', 'b'], null);
    expect(out.map((i) => i.public_id)).toEqual(['c', 'a', 'b']);
  });

  test('appends entries the order omits instead of dropping them', () => {
    const out = orderGallery([img('a'), img('b'), img('c')], ['c'], null);
    expect(out.map((i) => i.public_id)).toEqual(['c', 'a', 'b']);
  });

  test('ignores unknown keys in the order', () => {
    const out = orderGallery([img('a'), img('b')], ['ghost', 'b'], null);
    expect(out.map((i) => i.public_id)).toEqual(['b', 'a']);
  });

  test('ignores a duplicated key rather than cloning the image', () => {
    const out = orderGallery([img('a'), img('b')], ['a', 'a', 'b'], null);
    expect(out.map((i) => i.public_id)).toEqual(['a', 'b']);
  });

  test('marks exactly one primary, at the requested key', () => {
    const out = orderGallery([img('a'), img('b'), img('c')], null, 'b');
    expect(out.filter((i) => i.isPrimary).map((i) => i.public_id)).toEqual(['b']);
  });

  test('falls back to the first image when the primary key is unknown', () => {
    const out = orderGallery([img('a'), img('b')], null, 'ghost');
    expect(out.filter((i) => i.isPrimary).map((i) => i.public_id)).toEqual(['a']);
  });

  test('clears stale primaries so only one survives', () => {
    const out = orderGallery(
      [img('a', { isPrimary: true }), img('b', { isPrimary: true })],
      null,
      'b',
    );
    expect(out.filter((i) => i.isPrimary).map((i) => i.public_id)).toEqual(['b']);
  });

  test('handles an empty gallery without inventing a primary', () => {
    expect(orderGallery([], ['a'], 'a')).toEqual([]);
  });
});

describe('planGalleryCleanup', () => {
  const aliveExcept = (...deadIds) => (i) => !deadIds.includes(i.public_id);

  test('reports no change when every image is alive', () => {
    const plan = planGalleryCleanup({ images: [img('a'), img('b')] }, () => true);
    expect(plan.changed).toBe(false);
    expect(plan.dead).toEqual([]);
  });

  test('drops only the confirmed-dead images', () => {
    const plan = planGalleryCleanup(
      { images: [img('a'), img('b'), img('c')] },
      aliveExcept('b'),
    );
    expect(plan.changed).toBe(true);
    expect(plan.dead.map((i) => i.public_id)).toEqual(['b']);
    expect(plan.survivors.map((i) => i.public_id)).toEqual(['a', 'c']);
  });

  test('preserves the surviving order', () => {
    const plan = planGalleryCleanup(
      { images: [img('a'), img('b'), img('c'), img('d')] },
      aliveExcept('a', 'c'),
    );
    expect(plan.survivors.map((i) => i.public_id)).toEqual(['b', 'd']);
  });

  test('keeps the existing primary when it survives', () => {
    const plan = planGalleryCleanup(
      { images: [img('a'), img('b', { isPrimary: true }), img('c')] },
      aliveExcept('c'),
    );
    expect(plan.survivors.filter((i) => i.isPrimary).map((i) => i.public_id)).toEqual(['b']);
  });

  test('promotes the first survivor when the primary was the dead one', () => {
    // Otherwise the product keeps a gallery with no primary at all and stops
    // rendering a thumbnail in listings, feeds and search.
    const plan = planGalleryCleanup(
      { images: [img('a', { isPrimary: true }), img('b'), img('c')] },
      aliveExcept('a'),
    );
    expect(plan.survivors.filter((i) => i.isPrimary).map((i) => i.public_id)).toEqual(['b']);
  });

  test('flags a product left with no images', () => {
    const plan = planGalleryCleanup({ images: [img('a'), img('b')] }, () => false);
    expect(plan.emptied).toBe(true);
    expect(plan.survivors).toEqual([]);
  });

  test('does not flag emptied when survivors remain', () => {
    const plan = planGalleryCleanup({ images: [img('a'), img('b')] }, aliveExcept('a'));
    expect(plan.emptied).toBe(false);
  });

  test('removes a migrated image keyed by URL', () => {
    const legacy = { url: 'https://autobacsindia.com/wp-content/gone.jpg', isPrimary: true };
    const plan = planGalleryCleanup(
      { images: [legacy, img('b')] },
      (i) => i.public_id === 'b',
    );
    expect(plan.survivors.map((i) => i.public_id)).toEqual(['b']);
    expect(plan.survivors[0].isPrimary).toBe(true);
  });

  test('treats an unverified image as alive', () => {
    // The sweep must never read "could not check" as "is gone" — that is how a
    // Cloudinary API hiccup would wipe a live catalogue.
    const plan = planGalleryCleanup({ images: [img('a'), img('b')] }, () => true);
    expect(plan.changed).toBe(false);
    expect(plan.survivors).toHaveLength(2);
  });

  test('tolerates a product with no images array', () => {
    expect(planGalleryCleanup({}, () => false).changed).toBe(false);
    expect(planGalleryCleanup({ images: [] }, () => false).changed).toBe(false);
  });

  test('does not mutate the input product images', () => {
    const images = [img('a', { isPrimary: true }), img('b')];
    planGalleryCleanup({ images }, aliveExcept('a'));
    expect(images[0].isPrimary).toBe(true);
    expect(images).toHaveLength(2);
  });
});
