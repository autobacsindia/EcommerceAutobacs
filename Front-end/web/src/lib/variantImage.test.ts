/**
 * Tests — lib/variantImage.ts
 *
 * The contract that matters on the PDP: a model with a photo moves the gallery
 * to it, and NOTHING else moves the gallery. Getting the second half wrong is
 * what turns a helpful feature into one that fights the shopper.
 */
import { imageKeyOf, variantImageIndex, variantThumbnail } from './variantImage';

const R2 = 'https://img.autobacsindia.com/autobacs/products';
const img = (id: string, extra = {}) => ({
  url: `${R2}/${id}.jpg`, public_id: id, alt: id, ...extra,
});

const gallery = [img('pack', { isPrimary: true }), img('oncar'), img('smoked'), img('clear')];

describe('imageKeyOf', () => {
  test('prefers public_id', () => {
    expect(imageKeyOf({ url: 'u', public_id: 'pid' })).toBe('pid');
  });

  test('falls back to url for migrated rows with no public_id', () => {
    expect(imageKeyOf({ url: 'https://old/wp-content/a.jpg' })).toBe('https://old/wp-content/a.jpg');
  });

  test('returns empty string for junk rather than throwing', () => {
    expect(imageKeyOf(null)).toBe('');
    expect(imageKeyOf(undefined)).toBe('');
  });
});

describe('variantImageIndex', () => {
  test('finds the image a model points at', () => {
    expect(variantImageIndex(gallery, { _id: 'v1', imageKey: 'smoked' })).toBe(2);
    expect(variantImageIndex(gallery, { _id: 'v2', imageKey: 'clear' })).toBe(3);
  });

  test('a model with no photo returns null — the gallery must NOT move', () => {
    // Falling back to the primary here would yank a shopper who had swiped to the
    // fitment shot back to the hero image every time they changed size.
    expect(variantImageIndex(gallery, { _id: 'v1' })).toBeNull();
    expect(variantImageIndex(gallery, { _id: 'v1', imageKey: null })).toBeNull();
    expect(variantImageIndex(gallery, { _id: 'v1', imageKey: '  ' })).toBeNull();
  });

  test('a pointer at a removed image returns null, never -1', () => {
    // -1 would index past the array and blank the gallery on a live PDP.
    expect(variantImageIndex(gallery, { _id: 'v1', imageKey: 'deleted' })).toBeNull();
  });

  test('null variant and empty galleries are handled', () => {
    expect(variantImageIndex(gallery, null)).toBeNull();
    expect(variantImageIndex([], { _id: 'v1', imageKey: 'smoked' })).toBeNull();
    expect(variantImageIndex(undefined, { _id: 'v1', imageKey: 'smoked' })).toBeNull();
  });

  test('resolves legacy entries by url', () => {
    const legacy = { url: 'https://old/wp-content/a.jpg' };
    expect(variantImageIndex([legacy], { _id: 'v1', imageKey: legacy.url })).toBe(0);
  });
});

describe('variantThumbnail', () => {
  test('returns the model image when it has one', () => {
    expect(variantThumbnail(gallery, { _id: 'v1', imageKey: 'smoked' })?.public_id).toBe('smoked');
  });

  test('DOES fall back here — a single thumbnail must never be an empty box', () => {
    expect(variantThumbnail(gallery, { _id: 'v1' })?.public_id).toBe('pack');
  });

  test('falls back to the first image when nothing is flagged primary', () => {
    // 815 of 930 production products are in exactly this state.
    expect(variantThumbnail([img('a'), img('b')], { _id: 'v1' })?.public_id).toBe('a');
  });

  test('returns null only for a genuinely imageless product', () => {
    expect(variantThumbnail([], { _id: 'v1' })).toBeNull();
  });
});
