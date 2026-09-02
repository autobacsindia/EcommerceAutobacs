/**
 * Unit tests — services/storage/uploadTargets.js
 *
 * This module decides where a browser is allowed to write. Everything about the
 * object key is server-derived on purpose, so the tests are mostly about what a
 * client CANNOT influence:
 *
 *   - the extension comes from an allowlisted Content-Type, never the uploaded
 *     filename (that is how you end up serving .html or .svg off your own
 *     domain);
 *   - an unsupported type rejects the WHOLE batch rather than dropping one file,
 *     so a product can never reference an image that was never uploaded;
 *   - the batch is capped.
 */
import { jest } from '@jest/globals';

const mockPresignPut = jest.fn();
jest.unstable_mockModule('../../../services/storage/r2Provider.js', () => ({
  presignPut: (...a) => mockPresignPut(...a),
}));

const { buildKey, buildR2UploadTargets, UPLOAD_TYPES, MAX_BATCH } =
  await import('../../../services/storage/uploadTargets.js');

beforeEach(() => {
  jest.clearAllMocks();
  process.env.R2_PUBLIC_BASE_URL = 'https://img.autobacsindia.com';
  mockPresignPut.mockImplementation(async ({ key }) => ({
    url: `https://r2.example/${key}?X-Amz-Signature=x`, key, expiresIn: 900,
  }));
});

describe('buildKey', () => {
  test('derives the extension from the content type', () => {
    expect(buildKey('autobacs/products', 'image/png')).toMatch(/^autobacs\/products\/[0-9a-f]{24}\.png$/);
    expect(buildKey('autobacs/products', 'image/jpeg')).toMatch(/\.jpg$/);
    expect(buildKey('autobacs/products', 'image/webp')).toMatch(/\.webp$/);
  });

  test('is case-insensitive about the content type', () => {
    expect(buildKey('autobacs/products', 'IMAGE/PNG')).toMatch(/\.png$/);
  });

  test('returns "" for a type outside the allowlist', () => {
    // The extension must never come from something we did not vet.
    ['image/gif', 'image/svg+xml', 'text/html', 'application/pdf', '', null, undefined]
      .forEach((t) => expect(buildKey('autobacs/products', t)).toBe(''));
  });

  test('returns "" without a folder', () => {
    expect(buildKey('', 'image/png')).toBe('');
  });

  test('generates a distinct key every call', () => {
    const keys = new Set(Array.from({ length: 50 }, () => buildKey('f', 'image/png')));
    expect(keys.size).toBe(50);
  });

  test('the allowlist maps only to safe raster extensions', () => {
    expect(new Set(Object.values(UPLOAD_TYPES))).toEqual(new Set(['jpg', 'png', 'webp']));
  });
});

describe('buildR2UploadTargets', () => {
  test('returns one presigned target per file, with the public url', async () => {
    const t = await buildR2UploadTargets({
      folder: 'autobacs/products',
      files: [{ contentType: 'image/jpeg' }, { contentType: 'image/png' }],
    });
    expect(t).toHaveLength(2);
    expect(t[0].uploadUrl).toContain('X-Amz-Signature');
    expect(t[0].url).toBe(`https://img.autobacsindia.com/${t[0].key}`);
    expect(t[0].key).not.toBe(t[1].key);
  });

  test('signs the Content-Type so a mismatched PUT is refused by R2', async () => {
    await buildR2UploadTargets({ folder: 'f', files: [{ contentType: 'image/webp' }] });
    expect(mockPresignPut).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'public', contentType: 'image/webp',
    }));
  });

  test('always targets the PUBLIC bucket', async () => {
    await buildR2UploadTargets({ folder: 'f', files: [{ contentType: 'image/png' }] });
    expect(mockPresignPut.mock.calls[0][0].scope).toBe('public');
  });

  test('rejects the WHOLE batch when any type is unsupported', async () => {
    // Dropping just the bad file would let the client attach a product image
    // that was never uploaded.
    await expect(buildR2UploadTargets({
      folder: 'f',
      files: [{ contentType: 'image/jpeg' }, { contentType: 'image/svg+xml' }],
    })).rejects.toMatchObject({ statusCode: 400 });
    expect(mockPresignPut).not.toHaveBeenCalled();
  });

  test('caps the batch', async () => {
    const files = Array.from({ length: 30 }, () => ({ contentType: 'image/png' }));
    const t = await buildR2UploadTargets({ folder: 'f', files });
    expect(t).toHaveLength(MAX_BATCH);
  });

  test.each([undefined, null, [], 'nope', {}])('returns [] for unusable files %p', async (files) => {
    await expect(buildR2UploadTargets({ folder: 'f', files })).resolves.toEqual([]);
    expect(mockPresignPut).not.toHaveBeenCalled();
  });

  test('an uploaded filename cannot influence the key', async () => {
    // The client sends only a content type; there is no filename input at all.
    const t = await buildR2UploadTargets({
      folder: 'autobacs/products',
      files: [{ contentType: 'image/png', filename: '../../evil.html' }],
    });
    expect(t[0].key).toMatch(/^autobacs\/products\/[0-9a-f]{24}\.png$/);
    expect(t[0].key).not.toContain('evil');
    expect(t[0].key).not.toContain('..');
  });
});
