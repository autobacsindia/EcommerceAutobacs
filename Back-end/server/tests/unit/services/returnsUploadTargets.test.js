/**
 * Unit tests — services/storage/returnsUploadTargets.js
 *
 * Return evidence is the customer's side of a refund dispute, so the slot a file
 * was uploaded for is load-bearing: the video slot allows 60MB and the photo
 * slots 10MB, and if evidence could be moved between slots the cap on the
 * smaller one would be decorative. The minted key is what binds a file to its
 * slot, so most of these tests are about that binding holding.
 */
import { jest } from '@jest/globals';

const mockPresignPut = jest.fn();
jest.unstable_mockModule('../../../services/storage/r2Provider.js', () => ({
  presignPut: (...a) => mockPresignPut(...a),
}));

const {
  RETURNS_PREFIX, MAX_RETURN_PHOTOS, MAX_RETURN_FILES, RETURN_SLOTS,
  newReturnsFolder, slotFromKey, slotDefFromKey, buildReturnUploadTargets,
} = await import('../../../services/storage/returnsUploadTargets.js');
const { KIND } = await import('../../../services/storage/contentSniff.js');

const FOLDER = `${RETURNS_PREFIX}/0123456789abcdef01234567`;
const build = (files) => buildReturnUploadTargets({ folder: FOLDER, files });

beforeEach(() => {
  jest.clearAllMocks();
  mockPresignPut.mockImplementation(async ({ key }) => ({
    url: `https://r2.example/${key}?X-Amz-Signature=x`, key, expiresIn: 900,
  }));
});

describe('slot definitions', () => {
  /*
    Pinned literally: assetScope.js routes this prefix to the PRIVATE bucket and
    the submit-time folder guard matches on it. A rename here would start writing
    a customer's unboxing video to the public bucket.
  */
  test('the prefix is the one the private-bucket routing expects', () => {
    expect(RETURNS_PREFIX).toBe('autobacs/returns');
  });

  test('covers the required two plus the photo slots', () => {
    expect(RETURN_SLOTS.map((s) => s.key)).toEqual([
      'video', 'proof', 'photo0', 'photo1', 'photo2', 'photo3', 'photo4',
    ]);
    expect(MAX_RETURN_FILES).toBe(2 + MAX_RETURN_PHOTOS);
  });

  test('proof accepts an image OR a PDF — customers photograph invoices', () => {
    const proof = RETURN_SLOTS.find((s) => s.key === 'proof');
    expect(proof.kinds).toEqual(expect.arrayContaining([KIND.IMAGE, KIND.PDF]));
    expect(proof.types['application/pdf']).toBe('pdf');
    expect(proof.types['image/jpeg']).toBe('jpg');
  });

  test('the video slot accepts ONLY video kinds', () => {
    expect(RETURN_SLOTS.find((s) => s.key === 'video').kinds).toEqual([KIND.VIDEO]);
  });

  /*
    HEIC is what an iPhone produces by default. Rejecting it would refuse the
    most common photo a customer takes.
  */
  test('photo slots accept HEIC', () => {
    expect(RETURN_SLOTS.find((s) => s.key === 'photo0').types['image/heic']).toBe('heic');
  });

  test('no allowlisted type maps to a script-ish extension', () => {
    for (const slot of RETURN_SLOTS) {
      for (const ext of Object.values(slot.types)) {
        expect(['html', 'htm', 'svg', 'js', 'php', 'sh']).not.toContain(ext);
      }
    }
  });

  test('each slot carries its own cap, smallest on the photos', () => {
    const cap = (k) => RETURN_SLOTS.find((s) => s.key === k).maxBytes;
    expect(cap('video')).toBeGreaterThan(cap('proof'));
    expect(cap('proof')).toBeGreaterThan(cap('photo0'));
  });
});

describe('newReturnsFolder', () => {
  test('is unguessable and never repeats', () => {
    expect(newReturnsFolder()).toMatch(new RegExp(`^${RETURNS_PREFIX}/[0-9a-f]{24}$`));
    expect(new Set(Array.from({ length: 200 }, newReturnsFolder)).size).toBe(200);
  });
});

describe('slotFromKey / slotDefFromKey', () => {
  test('an indexed photo slot round-trips', async () => {
    const [t] = await build([{ slot: 'photo3', contentType: 'image/png' }]);
    expect(slotFromKey(t.key)).toBe('photo3');
    expect(slotDefFromKey(t.key).maxBytes).toBe(10 * 1024 * 1024);
  });

  /*
    Everything we did not mint must yield '' so the caller treats it as a
    mismatch. The traversal case matters most: it passes a naive
    startsWith(prefix) check while pointing elsewhere.
  */
  test.each([
    ['a legacy Cloudinary id', `${RETURNS_PREFIX}/abc/kj3h4kj23h4`],
    ['a traversal attempt',    `${FOLDER}/../../products/x-0011223344556677.mp4`],
    ['a foreign prefix',       'autobacs/careers/0123456789abcdef01234567/video-0011223344556677.mp4'],
    ['no slot segment',        `${FOLDER}/0011223344556677.mp4`],
    ['empty',                  ''],
    ['not a string',           null],
  ])('fails closed on %s', (_l, key) => {
    expect(slotFromKey(key)).toBe('');
    expect(slotDefFromKey(key)).toBeNull();
  });
});

describe('buildReturnUploadTargets', () => {
  test('mints one target per file, keyed by slot', async () => {
    const out = await build([
      { slot: 'video', contentType: 'video/mp4' },
      { slot: 'proof', contentType: 'application/pdf' },
    ]);
    expect(out.map((t) => t.slot)).toEqual(['video', 'proof']);
    expect(out[0].uploadUrl).toContain('X-Amz-Signature');
    expect(out[1].key).toMatch(/\/proof-[0-9a-f]{16}\.pdf$/);
  });

  /*
    Evidence in the public bucket would be a permanent unauthenticated URL to a
    customer's unboxing video and invoice.
  */
  test('signs every target against the PRIVATE bucket', async () => {
    await build(RETURN_SLOTS.map((s) => ({
      slot: s.key, contentType: s.key === 'video' ? 'video/mp4' : 'image/png',
    })));
    expect(mockPresignPut).toHaveBeenCalledTimes(RETURN_SLOTS.length);
    for (const [args] of mockPresignPut.mock.calls) expect(args.scope).toBe('private');
  });

  test('never hands back a readable URL', async () => {
    const out = await build([{ slot: 'proof', contentType: 'image/png' }]);
    expect(out[0]).not.toHaveProperty('url');
  });

  test('rejects a type the slot does not accept, naming the format wanted', async () => {
    await expect(build([{ slot: 'video', contentType: 'application/pdf' }]))
      .rejects.toThrow('Unboxing video must be a video (MP4/MOV/WEBM).');
    await expect(build([{ slot: 'photo0', contentType: 'application/pdf' }]))
      .rejects.toThrow('Photo must be an image (JPG/PNG/WebP/HEIC).');
    expect(mockPresignPut).not.toHaveBeenCalled();
  });

  test('rejects HTML and SVG in every slot', async () => {
    for (const slot of ['video', 'proof', 'photo0']) {
      for (const ct of ['text/html', 'image/svg+xml', 'application/x-sh']) {
        await expect(build([{ slot, contentType: ct }])).rejects.toMatchObject({ statusCode: 400 });
      }
    }
    expect(mockPresignPut).not.toHaveBeenCalled();
  });

  test('rejects an unknown slot without quoting it back', async () => {
    const err = await build([{ slot: '../careers', contentType: 'image/png' }]).catch((e) => e);
    expect(err.message).toBe('Unrecognised upload slot.');
    expect(err.expose).toBe(true);
  });

  test('rejects a repeated slot rather than minting free storage', async () => {
    await expect(build([
      { slot: 'photo0', contentType: 'image/png' },
      { slot: 'photo0', contentType: 'image/png' },
    ])).rejects.toMatchObject({ statusCode: 400 });
    expect(mockPresignPut).not.toHaveBeenCalled();
  });

  test('a bad type anywhere rejects the WHOLE batch', async () => {
    await expect(build([
      { slot: 'video', contentType: 'video/mp4' },
      { slot: 'proof', contentType: 'text/html' },
    ])).rejects.toMatchObject({ statusCode: 400 });
    // Nothing signed: a submission can never reference a file never uploaded.
    expect(mockPresignPut).not.toHaveBeenCalled();
  });

  test.each([['no files', []], ['undefined', undefined], ['not an array', {}]])(
    'returns nothing for %s', async (_l, files) => {
      await expect(build(files)).resolves.toEqual([]);
      expect(mockPresignPut).not.toHaveBeenCalled();
    });
});
