/**
 * Unit tests — services/storage/variantGenerator.js
 *
 * Uses REAL sharp against tiny synthetic images rather than a mock: the things
 * most likely to break are encoder behaviours (does AVIF actually come out as
 * AVIF, does withoutEnlargement really refuse to upscale), and a mock would
 * assert our assumptions about sharp instead of sharp.
 *
 * Storage is injected, so nothing here touches R2.
 */
import { jest } from '@jest/globals';
import sharp from 'sharp';
import { probe, renderVariant, generateVariants, ENCODE } from '../../../services/storage/variantGenerator.js';
import { LADDER, FORMATS, plannedVariants } from '../../../services/storage/variants.js';

/** A solid-colour source of the given size. */
const makeImage = (width, height = width) =>
  sharp({ create: { width, height, channels: 3, background: { r: 180, g: 90, b: 40 } } })
    .jpeg().toBuffer();

describe('probe', () => {
  test('reads intrinsic dimensions and format', async () => {
    await expect(probe(await makeImage(300, 200)))
      .resolves.toMatchObject({ width: 300, height: 200, format: 'jpeg' });
  });
});

describe('renderVariant', () => {
  test('produces a real AVIF', async () => {
    const out = await renderVariant(await makeImage(400), 256, 'avif');
    await expect(sharp(out).metadata()).resolves.toMatchObject({ format: 'heif', width: 256 });
  });

  test('produces a real WebP', async () => {
    const out = await renderVariant(await makeImage(400), 256, 'webp');
    await expect(sharp(out).metadata()).resolves.toMatchObject({ format: 'webp', width: 256 });
  });

  test('NEVER upscales, even when asked for a rung wider than the source', async () => {
    // widthsFor() should prevent this, but the encoder refuses independently —
    // an upscaled variant is a bigger file carrying no extra detail.
    const out = await renderVariant(await makeImage(200), 1920, 'webp');
    await expect(sharp(out).metadata()).resolves.toMatchObject({ width: 200 });
  });

  test('preserves aspect ratio', async () => {
    const out = await renderVariant(await makeImage(800, 400), 256, 'webp');
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(256);
    expect(meta.height).toBe(128);
  });

  test('rejects an unsupported format rather than silently emitting something else', async () => {
    await expect(renderVariant(await makeImage(200), 128, 'jpeg')).rejects.toThrow(/unsupported format/);
  });

  test('AVIF is smaller than WebP on photographic content', async () => {
    /*
      The whole reason AVIF is listed first in FORMATS, and the basis of the
      measured -56% against Cloudinary's current output.

      The fixture is blurred noise — smooth gradients with soft edges, which is
      structurally what a product photograph is. UNBLURRED noise is deliberately
      avoided: random noise defeats the spatial prediction AVIF wins on, so AVIF
      comes out ~14% LARGER there. That is a real property of the codec, not a
      bug, and it does not describe any image in this catalog (measured on a real
      product shot: AVIF 8,445 B vs WebP 9,554 B at w384).
    */
    const photoish = await sharp({
      create: { width: 600, height: 600, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 60 } },
    }).blur(8).jpeg({ quality: 90 }).toBuffer();
    const [a, w] = await Promise.all([
      renderVariant(photoish, 384, 'avif'),
      renderVariant(photoish, 384, 'webp'),
    ]);
    expect(a.length).toBeLessThan(w.length);
  });
});

describe('generateVariants', () => {
  const deps = (over = {}) => ({
    putObject: jest.fn().mockResolvedValue({}),
    headObject: jest.fn().mockResolvedValue(null),
    ...over,
  });

  test('writes every planned variant with the right key, type and cache header', async () => {
    const d = deps();
    const r = await generateVariants({
      buffer: await makeImage(400), originalKey: 'autobacs/products/abc.jpg', ...d,
    });
    // 400px source → rungs 128, 256, 384, plus the full rung at 400px.
    expect(r.written).toBe(4 * FORMATS.length);
    const keys = d.putObject.mock.calls.map((c) => c[0].key);
    expect(keys).toContain('variants/autobacs/products/abc/w384.avif');
    expect(keys).toContain('variants/autobacs/products/abc/w128.webp');
    expect(keys.some((k) => k.includes('w640'))).toBe(false); // no upscale
    /*
      The full rung is what the Worker serves when a browser asks for a rung this
      source cannot fill — next/image emits a srcset across every rung regardless
      of the source, so that happens constantly. Without it those requests fall
      through to the raw original.
    */
    expect(keys).toContain('variants/autobacs/products/abc/full.avif');
    expect(keys).toContain('variants/autobacs/products/abc/full.webp');

    const avifCall = d.putObject.mock.calls.find((c) => c[0].key.endsWith('.avif'))[0];
    expect(avifCall).toMatchObject({
      scope: 'public',
      contentType: 'image/avif',
      cacheControl: 'public, max-age=31536000, immutable',
    });
    expect(d.putObject.mock.calls.find((c) => c[0].key.endsWith('.webp'))[0].contentType)
      .toBe('image/webp');
  });

  test('reports the source width it planned against', async () => {
    const r = await generateVariants({
      buffer: await makeImage(1000), originalKey: 'autobacs/products/abc.jpg', ...deps(),
    });
    expect(r.sourceWidth).toBe(1000);
  });

  test('SKIPS variants already present — a backfill must be resumable', async () => {
    const d = deps({ headObject: jest.fn().mockResolvedValue({ bytes: 123 }) });
    const r = await generateVariants({
      buffer: await makeImage(400), originalKey: 'autobacs/products/abc.jpg', ...d,
    });
    expect(r.written).toBe(0);
    expect(r.skipped).toBe(4 * FORMATS.length);   // 3 rungs + full
    expect(d.putObject).not.toHaveBeenCalled();
  });

  test('force re-encodes even when the variant exists', async () => {
    const d = deps({ headObject: jest.fn().mockResolvedValue({ bytes: 123 }) });
    const r = await generateVariants({
      buffer: await makeImage(400), originalKey: 'autobacs/products/abc.jpg', force: true, ...d,
    });
    expect(r.skipped).toBe(0);
    expect(r.written).toBe(4 * FORMATS.length);   // 3 rungs + full
  });

  test('one failed variant does not abandon the rest', async () => {
    const d = deps({
      putObject: jest.fn()
        .mockRejectedValueOnce(new Error('R2 refused'))
        .mockResolvedValue({}),
    });
    const r = await generateVariants({
      buffer: await makeImage(400), originalKey: 'autobacs/products/abc.jpg', ...d,
    });
    expect(r.failed).toHaveLength(1);
    expect(r.written).toBe(4 * FORMATS.length - 1);   // 3 rungs + full, minus the one that threw
  });

  test('a tiny source still gets the smallest rung rather than nothing', async () => {
    const r = await generateVariants({
      buffer: await makeImage(64), originalKey: 'autobacs/products/tiny.jpg', ...deps(),
    });
    // The smallest rung, plus the full rung at the source's own 64px — so even a
    // tiny image is served in a modern codec rather than falling back to raw.
    expect(r.written).toBe(2 * FORMATS.length);
    // The smallest rung is planned at 128 and the full rung at the source's 64.
    // sharp's withoutEnlargement means BOTH come out 64px wide — the widths here
    // are what was planned, not what was produced, and neither is an upscale.
    expect(r.variants.every((v) => v.width === LADDER[0] || v.width === 64)).toBe(true);
  });

  test('works without a headObject probe (skip-check is optional)', async () => {
    const d = deps({ headObject: undefined });
    const r = await generateVariants({
      buffer: await makeImage(300), originalKey: 'autobacs/products/abc.jpg', ...d,
    });
    expect(r.written).toBeGreaterThan(0);
    expect(r.skipped).toBe(0);
  });

  test('reports total bytes written', async () => {
    const r = await generateVariants({
      buffer: await makeImage(400), originalKey: 'autobacs/products/abc.jpg', ...deps(),
    });
    expect(r.bytes).toBe(r.variants.reduce((s, v) => s + v.bytes, 0));
    expect(r.bytes).toBeGreaterThan(0);
  });
});

describe('encoder settings', () => {
  test('AVIF uses full chroma — product colour must not be subsampled', () => {
    expect(ENCODE.avif.chromaSubsampling).toBe('4:4:4');
  });
});

describe('existingKeys — the optimisation that made the backfill viable', () => {
  const deps = (over = {}) => ({
    putObject: jest.fn().mockResolvedValue({}),
    ...over,
  });

  test('skips via the Set with NO network probe at all', async () => {
    // A HEAD per variant cost ~316ms each; over 6,243 originals that was
    // ~62,000 requests and hours of wall time, almost all returning 404.
    const headObject = jest.fn();
    const d = deps({ headObject });
    const buffer = await makeImage(400);
    /*
      Pre-populate every key the 400px source will plan — DERIVED from
      plannedVariants rather than listed by hand, so adding a rung (as the full
      rung was) cannot silently leave this test asserting a stale count.
    */
    const planned = plannedVariants('autobacs/products/abc.jpg', 400);
    const existingKeys = new Set(planned.map((v) => v.key));
    const r = await generateVariants({ buffer, originalKey: 'autobacs/products/abc.jpg', existingKeys, ...d });
    expect(r.skipped).toBe(planned.length);
    expect(r.written).toBe(0);
    expect(headObject).not.toHaveBeenCalled();
    expect(d.putObject).not.toHaveBeenCalled();
  });

  test('renders only the variants missing from the Set', async () => {
    const d = deps();
    const existingKeys = new Set(['variants/autobacs/products/abc/w128.avif']);
    const r = await generateVariants({
      buffer: await makeImage(400), originalKey: 'autobacs/products/abc.jpg', existingKeys, ...d,
    });
    const planned = plannedVariants('autobacs/products/abc.jpg', 400);
    expect(r.skipped).toBe(1);
    expect(r.written).toBe(planned.length - 1);
    expect(d.putObject.mock.calls.map((c) => c[0].key))
      .not.toContain('variants/autobacs/products/abc/w128.avif');
  });

  test('the Set wins over headObject when both are supplied', async () => {
    const headObject = jest.fn().mockResolvedValue({ bytes: 1 });
    const d = deps({ headObject });
    const r = await generateVariants({
      buffer: await makeImage(400), originalKey: 'autobacs/products/abc.jpg',
      existingKeys: new Set(), ...d,
    });
    expect(headObject).not.toHaveBeenCalled();
    expect(r.written).toBe(plannedVariants('autobacs/products/abc.jpg', 400).length);
  });

  test('force ignores the Set entirely', async () => {
    const d = deps();
    const existingKeys = new Set(['variants/autobacs/products/abc/w128.avif']);
    const r = await generateVariants({
      buffer: await makeImage(400), originalKey: 'autobacs/products/abc.jpg',
      existingKeys, force: true, ...d,
    });
    expect(r.skipped).toBe(0);
    expect(r.written).toBe(plannedVariants('autobacs/products/abc.jpg', 400).length);
  });

  test('one failing variant still does not sink the others, now that they run in parallel', async () => {
    const d = deps({
      putObject: jest.fn().mockRejectedValueOnce(new Error('R2 refused')).mockResolvedValue({}),
    });
    const r = await generateVariants({
      buffer: await makeImage(400), originalKey: 'autobacs/products/abc.jpg',
      existingKeys: new Set(), ...d,
    });
    expect(r.failed).toHaveLength(1);
    expect(r.written).toBe(plannedVariants('autobacs/products/abc.jpg', 400).length - 1);
    // A rung OR the full variant — both are legitimate members of the plan.
    expect(r.failed[0].key).toMatch(/^variants\/autobacs\/products\/abc\/(w\d+|full)\.(avif|webp)$/);
  });
});
