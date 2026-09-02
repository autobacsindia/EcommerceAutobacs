/**
 * Unit tests — services/storage/privateAssetUrl.js and the provider routing in
 * the three private-asset minters.
 *
 * These read paths cover applicant CVs and answer videos, customers' return
 * evidence, and support attachments. Two failure directions matter, and they
 * are not symmetric:
 *
 *   - routing an R2 asset to Cloudinary yields a URL that 404s: a broken admin
 *     view, recoverable;
 *   - routing to the wrong bucket, or minting anything that outlives its TTL,
 *     is a disclosure.
 *
 * So the tests lean on the defaults: a ref with no `provider` MUST resolve to
 * Cloudinary (every row written before the migration is one), and the R2 branch
 * must always target the private bucket with a bounded expiry.
 */
import { jest } from '@jest/globals';

const mockPresignGet = jest.fn();
jest.unstable_mockModule('../../../services/storage/r2Provider.js', () => ({
  presignGet: (...a) => mockPresignGet(...a),
}));

const { providerOf, r2PrivateUrl } = await import('../../../services/storage/privateAssetUrl.js');

beforeEach(() => {
  jest.clearAllMocks();
  process.env.R2_SIGNED_GET_TTL_SECONDS = '300';
  mockPresignGet.mockResolvedValue('https://signed.example/obj?X-Amz-Signature=x');
});

describe('providerOf — absent means Cloudinary', () => {
  test.each([
    [undefined, 'cloudinary'],
    [null, 'cloudinary'],
    [{}, 'cloudinary'],
    [{ provider: undefined }, 'cloudinary'],
    [{ provider: '' }, 'cloudinary'],
    [{ provider: 'cloudinary' }, 'cloudinary'],
    [{ provider: 'r2' }, 'r2'],
  ])('%p -> %s', (ref, expected) => {
    expect(providerOf(ref)).toBe(expected);
  });

  test('is case- and whitespace-tolerant', () => {
    // A stray 'R2' routing to Cloudinary would 404 rather than leak, but it is
    // a needless foot-gun when we control every writer.
    expect(providerOf({ provider: 'R2' })).toBe('r2');
    expect(providerOf({ provider: ' r2 ' })).toBe('r2');
  });

  test('an unrecognised provider falls back to Cloudinary, not to R2', () => {
    // Fail toward the legacy store: a 404 beats reaching into the wrong bucket.
    expect(providerOf({ provider: 's3' })).toBe('cloudinary');
    expect(providerOf({ provider: 'public' })).toBe('cloudinary');
  });
});

describe('r2PrivateUrl', () => {
  test('always targets the PRIVATE bucket', async () => {
    await r2PrivateUrl({ key: 'autobacs/careers/n/cv.pdf' });
    expect(mockPresignGet).toHaveBeenCalledWith(expect.objectContaining({
      key: 'autobacs/careers/n/cv.pdf',
      scope: 'private',
    }));
  });

  test('scope cannot be overridden by a caller', async () => {
    // There is no legitimate reason to sign a public object, and allowing it
    // would let a future caller point this at the public bucket by mistake.
    await r2PrivateUrl({ key: 'k', scope: 'public' });
    expect(mockPresignGet.mock.calls[0][0].scope).toBe('private');
  });

  test('defaults to the configured short TTL', async () => {
    await r2PrivateUrl({ key: 'k' });
    expect(mockPresignGet.mock.calls[0][0].expiresIn).toBe(300);
  });

  test('honours an explicit TTL', async () => {
    await r2PrivateUrl({ key: 'k', ttlSeconds: 3600 });
    expect(mockPresignGet.mock.calls[0][0].expiresIn).toBe(3600);
  });

  test('passes a download filename through', async () => {
    await r2PrivateUrl({ key: 'k', downloadAs: 'resume.pdf' });
    expect(mockPresignGet.mock.calls[0][0].downloadAs).toBe('resume.pdf');
  });

  test.each([undefined, null, '', 0])('returns "" for unusable key %p without signing', async (key) => {
    await expect(r2PrivateUrl({ key })).resolves.toBe('');
    expect(mockPresignGet).not.toHaveBeenCalled();
  });

  test('called with no argument at all does not throw', async () => {
    await expect(r2PrivateUrl()).resolves.toBe('');
  });
});
