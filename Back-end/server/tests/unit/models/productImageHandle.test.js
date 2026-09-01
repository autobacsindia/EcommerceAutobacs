/**
 * Unit tests — Product.images[].public_id requirement.
 *
 * `public_id` is the DELETE HANDLE. Without it, removing an image from a
 * product drops the Mongo row and leaks the object: nothing references it and
 * nothing can address it, so no cleanup sweep will ever find it. That failure
 * shape is not hypothetical here — the identical gap in the careers flow
 * produced 1.68 GB of unreachable uploads.
 *
 * The rule used to be `url.includes('cloudinary.com')`, which would have
 * silently exempted every R2 image the moment uploads moved there — leaking
 * from cutover day with no error anywhere. These tests pin the widened rule and,
 * more importantly, pin the two directions it must NOT go: it must still demand
 * a handle for Cloudinary, and must still tolerate genuinely external URLs we
 * cannot delete.
 */
import { jest } from '@jest/globals';

const R2_HOST = 'https://img.autobacsindia.com';

const { default: Product, isHostedImageUrl } = await import('../../../models/Product.js');

const baseProduct = (images) => new Product({
  name: 'Test Product',
  slug: `test-${Math.random().toString(36).slice(2)}`,
  description: 'x',
  price: 100,
  stock: 'in',
  images,
});

/** Validate without touching a database. */
const validationError = (images) => {
  const err = baseProduct(images).validateSync();
  return err?.errors ? Object.keys(err.errors).filter((k) => k.includes('public_id')) : [];
};

beforeEach(() => { process.env.R2_PUBLIC_BASE_URL = R2_HOST; });

describe('isHostedImageUrl', () => {
  test('Cloudinary is ours', () => {
    expect(isHostedImageUrl('https://res.cloudinary.com/c/image/upload/v1/a.jpg')).toBe(true);
  });

  test('the R2 delivery host is ours', () => {
    expect(isHostedImageUrl(`${R2_HOST}/autobacs/products/a.jpg`)).toBe(true);
  });

  test('legacy wp-content is NOT ours — we cannot delete it', () => {
    expect(isHostedImageUrl('https://autobacsindia.com/wp-content/uploads/a.jpg')).toBe(false);
  });

  test('third-party stock imagery is not ours', () => {
    expect(isHostedImageUrl('https://images.unsplash.com/photo-1')).toBe(false);
  });

  test('reads R2_PUBLIC_BASE_URL at CALL time, not import time', () => {
    // Scripts load dotenv after the model graph is built. A value captured at
    // import would be empty and would exempt every R2 image from the rule.
    delete process.env.R2_PUBLIC_BASE_URL;
    expect(isHostedImageUrl(`${R2_HOST}/autobacs/products/a.jpg`)).toBe(false);
    process.env.R2_PUBLIC_BASE_URL = R2_HOST;
    expect(isHostedImageUrl(`${R2_HOST}/autobacs/products/a.jpg`)).toBe(true);
  });

  test('a different host on the same apex is not ours', () => {
    expect(isHostedImageUrl('https://www.autobacsindia.com/a.jpg')).toBe(false);
  });

  test.each([undefined, null, '', 'not a url', 42, {}])('is false for unusable input %p', (u) => {
    expect(isHostedImageUrl(u)).toBe(false);
  });
});

describe('public_id requirement', () => {
  test('REQUIRED for an R2 image — the gap that would have leaked on cutover', () => {
    expect(validationError([{ url: `${R2_HOST}/autobacs/products/a.jpg` }])).toHaveLength(1);
  });

  test('REQUIRED for a Cloudinary image (unchanged behaviour)', () => {
    expect(validationError([{ url: 'https://res.cloudinary.com/c/image/upload/v1/a.jpg' }]))
      .toHaveLength(1);
  });

  test('satisfied when the handle is present', () => {
    expect(validationError([
      { url: `${R2_HOST}/autobacs/products/a.jpg`, public_id: 'autobacs/products/a.jpg' },
      { url: 'https://res.cloudinary.com/c/image/upload/v1/b.jpg', public_id: 'autobacs/products/b' },
    ])).toHaveLength(0);
  });

  test('NOT required for legacy wp-content — we do not own it', () => {
    // Demanding a handle here would only block saves on migrated products.
    expect(validationError([{ url: 'https://autobacsindia.com/wp-content/uploads/a.jpg' }]))
      .toHaveLength(0);
  });

  test('NOT required for external stock imagery', () => {
    expect(validationError([{ url: 'https://images.unsplash.com/photo-1' }])).toHaveLength(0);
  });

  test('a mixed gallery flags only the hosted image that lacks a handle', () => {
    const errs = validationError([
      { url: 'https://autobacsindia.com/wp-content/uploads/legacy.jpg' },
      { url: `${R2_HOST}/autobacs/products/missing.jpg` },
      { url: `${R2_HOST}/autobacs/products/ok.jpg`, public_id: 'autobacs/products/ok.jpg' },
    ]);
    expect(errs).toEqual(['images.1.public_id']);
  });

  test('an empty gallery is valid', () => {
    expect(validationError([])).toHaveLength(0);
  });
});
