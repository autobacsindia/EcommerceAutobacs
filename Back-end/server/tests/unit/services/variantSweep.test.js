/**
 * Image variants: the upload-time job id, and the nightly catch-up finder.
 */

import { findOriginalsMissingVariants } from '../../../services/storage/variantSweep.js';
import { variantJobId } from '../../../queue/queues.js';

/**
 * BullMQ's rule (bullmq/dist/cjs/classes/job.js, validateOptions): a custom id
 * containing ':' must have exactly three ':'-separated parts, or add() throws
 * "Custom Id cannot contain :". The old `variants:<key>` id broke this on every
 * upload. Mirrored here so a regression fails in CI without a Redis.
 */
const bullmqAccepts = (id) => !(id.includes(':') && id.split(':').length !== 3);

describe('variantJobId', () => {
  it('produces ids BullMQ accepts — the bug that stopped every upload getting variants', () => {
    expect(bullmqAccepts('variants:autobacs/products/abc.png')).toBe(false); // the old id
    for (const id of [
      variantJobId('autobacs/products/abc.png'),
      variantJobId('autobacs/products/abc.png', 'sweep', '2026-10-07'),
      variantJobId('odd:key:with:colons.png'),
    ]) {
      expect(id).not.toContain(':');
      expect(bullmqAccepts(id)).toBe(true);
    }
  });

  it('keeps one id per original so duplicate uploads collapse onto one job', () => {
    expect(variantJobId('autobacs/products/a.png')).toBe(variantJobId('autobacs/products/a.png'));
    expect(variantJobId('autobacs/products/a.png')).not.toBe(variantJobId('autobacs/products/b.png'));
  });
});

describe('findOriginalsMissingVariants', () => {
  const bucket = (keys) => async ({ prefix }) => keys.filter((k) => k.startsWith(prefix)).map((key) => ({ key }));

  it('finds originals with no variants at all, and nothing else', async () => {
    const listKeys = bucket([
      'autobacs/products/has-variants.png',
      'variants/autobacs/products/has-variants/w640.avif',
      'variants/autobacs/products/has-variants/w640.webp',
      'autobacs/products/never-rendered.png',
      'autobacs/products/also-missing.jpg',
      'autobacs/products/readme.txt',                // not an image
    ]);
    const res = await findOriginalsMissingVariants({ listKeys });
    expect(res.scanned).toBe(3);
    expect(res.missing.sort()).toEqual(['autobacs/products/also-missing.jpg', 'autobacs/products/never-rendered.png']);
    expect(res.missingTotal).toBe(2);
  });

  it('treats a partly rendered ladder as handled (the media job retries those)', async () => {
    const listKeys = bucket(['autobacs/products/p.png', 'variants/autobacs/products/p/w256.avif']);
    expect((await findOriginalsMissingVariants({ listKeys })).missing).toEqual([]);
  });

  it('caps the nightly batch but reports the full count', async () => {
    const keys = Array.from({ length: 10 }, (_, i) => `autobacs/products/img${i}.png`);
    const res = await findOriginalsMissingVariants({ listKeys: bucket(keys), limit: 4 });
    expect(res.missing).toHaveLength(4);
    expect(res.missingTotal).toBe(10);
  });

  it('never picks up private assets', async () => {
    const listKeys = bucket(['autobacs/careers/cv-photo.png', 'autobacs/products/x.png']);
    const res = await findOriginalsMissingVariants({ listKeys });
    expect(res.missing).toEqual(['autobacs/products/x.png']);
  });
});
