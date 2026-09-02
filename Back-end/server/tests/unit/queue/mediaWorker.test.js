/**
 * Unit tests — queue/workers/mediaWorker.js (the generate-variants handler)
 *
 * This job runs against an object that USUALLY DOES NOT EXIST YET: it is
 * enqueued when the presigned URL is issued, not when the browser finishes
 * uploading. So the behaviour that matters most is what it does when the object
 * is absent, when it is not an image, and when it is not ours to render.
 *
 * Every one of those failures is quiet rather than loud — missing variants just
 * mean bigger images, which nobody notices until the bandwidth bill does.
 */
import { jest } from '@jest/globals';

const headObject = jest.fn();
const getObjectBuffer = jest.fn();
const listKeys = jest.fn();
const putObject = jest.fn();
const generateVariants = jest.fn();

// Capture the processor the Worker is constructed with — that function IS the
// unit under test, and driving it is exactly what BullMQ does at runtime.
let processor;
jest.unstable_mockModule('bullmq', () => ({
  Worker: class { constructor(_name, fn) { processor = fn; } on() {} },
}));
jest.unstable_mockModule('@sentry/node', () => ({ withScope: jest.fn(), captureException: jest.fn() }));
jest.unstable_mockModule('../../../queue/connection.js', () => ({ createConnection: () => ({}) }));
jest.unstable_mockModule('../../../services/storage/r2Provider.js', () => ({
  headObject: (...a) => headObject(...a),
  getObjectBuffer: (...a) => getObjectBuffer(...a),
  listKeys: (...a) => listKeys(...a),
  putObject: (...a) => putObject(...a),
}));
jest.unstable_mockModule('../../../services/storage/variantGenerator.js', () => ({
  generateVariants: (...a) => generateVariants(...a),
}));

const { startMediaWorker } = await import('../../../queue/workers/mediaWorker.js');
const { VARIANT_PREFIX, variantKey } = await import('../../../services/storage/variants.js');

beforeAll(() => {
  process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
  startMediaWorker();
});

const run = (key) => processor({ name: 'generate-variants', data: { key } });

beforeEach(() => {
  jest.clearAllMocks();
  headObject.mockResolvedValue({ bytes: 1000, contentType: 'image/jpeg' });
  getObjectBuffer.mockResolvedValue(Buffer.from('jpegbytes'));
  listKeys.mockResolvedValue([]);
  generateVariants.mockResolvedValue({ written: 14, skipped: 0, failed: [], bytes: 40000 });
});

describe('generate-variants', () => {
  test('renders variants for a public image', async () => {
    await expect(run('autobacs/products/a/photo.jpg')).resolves.toMatchObject({ written: 14 });
    expect(generateVariants).toHaveBeenCalledWith(expect.objectContaining({
      originalKey: 'autobacs/products/a/photo.jpg',
    }));
  });

  /*
    THE central case. The job fires ~20s after the URL was issued, so a slow
    upload is normal. It must THROW so BullMQ retries — returning quietly would
    permanently skip an image that was seconds away from existing.
  */
  test('throws when the object is not uploaded yet, so the job retries', async () => {
    headObject.mockResolvedValue(null);
    await expect(run('autobacs/products/a/photo.jpg')).rejects.toThrow(/not present yet/);
    expect(getObjectBuffer).not.toHaveBeenCalled();
    expect(generateVariants).not.toHaveBeenCalled();
  });

  /*
    A private asset acquiring public derivatives would defeat the two-bucket
    split entirely — an applicant's CV or a customer's unboxing video is not
    something to render public thumbnails of.
  */
  test.each([
    ['a careers CV',    'autobacs/careers/0123456789abcdef01234567/resume-0011223344556677.pdf'],
    ['return evidence', 'autobacs/returns/0123456789abcdef01234567/video-0011223344556677.mp4'],
    ['a shipping slip', 'shipping-slips/slip-1.pdf'],
    ['an invoice',      'invoices/AB-1.pdf'],
  ])('refuses %s — never renders a private asset', async (_l, key) => {
    await expect(run(key)).resolves.toMatchObject({ skipped: 'not-public' });
    expect(getObjectBuffer).not.toHaveBeenCalled();
    expect(putObject).not.toHaveBeenCalled();
  });

  test('refuses a variant key — rendering one would recurse', async () => {
    await expect(run(`${VARIANT_PREFIX}/autobacs/products/a/photo.jpg/w640.avif`))
      .resolves.toMatchObject({ skipped: expect.any(String) });
    expect(generateVariants).not.toHaveBeenCalled();
  });

  /*
    R2 does not enforce the Content-Type a URL was signed with, so "the endpoint
    only signs image types" is not evidence the bytes are one. Handing a PDF to
    sharp would throw on every retry until the attempts ran out.
  */
  test.each([
    ['a PDF',   'application/pdf'],
    ['HTML',    'text/html'],
    ['SVG',     'image/svg+xml'],
    ['nothing', ''],
  ])('skips %s rather than feeding it to sharp', async (_l, contentType) => {
    headObject.mockResolvedValue({ bytes: 10, contentType });
    await expect(run('autobacs/products/a/photo.jpg')).resolves.toMatchObject({ skipped: 'not-an-image' });
    expect(generateVariants).not.toHaveBeenCalled();
  });

  /*
    REGRESSION. Variant keys are built from the original with its EXTENSION
    STRIPPED (`…/photo.jpg` → `variants/…/photo/w640.avif`), so listing under the
    raw original key matches nothing. The first version of this worker did
    exactly that, and the bug is silent — every job simply concludes no variants
    exist and re-encodes the whole ladder. A live run caught it; a mocked
    assertion on the prefix string would not have, which is why this test
    derives the expected key from the REAL variantKey() rather than a literal.
  */
  test('lists variants under the prefix real variant keys actually use', async () => {
    const original = 'autobacs/products/a/photo.jpg';
    const realKey = variantKey(original, 640, 'avif');
    listKeys.mockResolvedValue([{ key: realKey }]);

    await run(original);

    const prefix = listKeys.mock.calls[0][0].prefix;
    expect(realKey.startsWith(prefix)).toBe(true);
    expect(generateVariants.mock.calls[0][0].existingKeys.has(realKey)).toBe(true);
  });

  test('probes with ONE listing, not a HEAD per planned variant', async () => {
    await run('autobacs/products/a/photo.jpg');
    // The backfill measured per-variant probes as roughly half of all round trips.
    expect(listKeys).toHaveBeenCalledTimes(1);
    expect(headObject).toHaveBeenCalledTimes(1);
  });

  /*
    A half-rendered ladder is worse than none: the image Worker would serve AVIF
    at some widths and fall back to the original at others, so the page silently
    gets heavier at exactly the breakpoints that failed.
  */
  test('a partial failure throws so the job retries', async () => {
    generateVariants.mockResolvedValue({
      written: 10, skipped: 0, bytes: 1, failed: [{ key: 'x', error: 'boom' }],
    });
    await expect(run('autobacs/products/a/photo.jpg')).rejects.toThrow(/failed/);
  });

  test('rejects a job with no key', async () => {
    await expect(processor({ name: 'generate-variants', data: {} })).rejects.toThrow(/requires a key/);
  });

  test('rejects an unknown job name', async () => {
    await expect(processor({ name: 'nope', data: {} })).rejects.toThrow(/Unknown media job/);
  });
});
