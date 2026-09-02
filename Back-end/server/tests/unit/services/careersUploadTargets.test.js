/**
 * Unit tests — services/storage/careersUploadTargets.js
 *
 * This is the ONE unauthenticated endpoint that hands out write credentials for
 * our storage, so the tests are weighted toward what a hostile caller cannot do:
 * choose the folder, choose the extension, request more targets than there are
 * slots, or aim a target at the public bucket.
 *
 * What these tests deliberately do NOT prove: that the uploaded bytes are a
 * video or a PDF. R2 does not enforce the signed Content-Type (verified against
 * the live bucket), so the allowlist here is an early, friendly rejection and
 * nothing more. The real check is the magic-byte sniff at submit time — see
 * contentSniff.test.js.
 */
import { jest } from '@jest/globals';

const mockPresignPut = jest.fn();
jest.unstable_mockModule('../../../services/storage/r2Provider.js', () => ({
  presignPut: (...a) => mockPresignPut(...a),
}));

const {
  CAREERS_PREFIX,
  CAREERS_UPLOAD_TYPES,
  MAX_CAREERS_FILES,
  extensionFor,
  newCareersFolder,
  buildCareersKey,
  slotFromKey,
  buildCareersUploadTargets,
} = await import('../../../services/storage/careersUploadTargets.js');

// Mirrors FILE_SLOTS in controllers/jobApplicationController.js.
const SLOTS = [
  { key: 'videoOne', label: 'Video answer 1', resourceType: 'video' },
  { key: 'videoTwo', label: 'Video answer 2', resourceType: 'video' },
  { key: 'resume',   label: 'Resume',         resourceType: 'raw'   },
  { key: 'support',  label: 'Supporting document', resourceType: 'raw' },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockPresignPut.mockImplementation(async ({ key }) => ({
    url: `https://r2.example/${key}?X-Amz-Signature=x`, key, expiresIn: 900,
  }));
});

// A realistic folder: newCareersFolder() mints a 24-hex nonce, and slotFromKey
// validates the whole key shape, so a toy folder would not round-trip.
const FOLDER = `${CAREERS_PREFIX}/0123456789abcdef01234567`;
const build = (files) => buildCareersUploadTargets({ folder: FOLDER, files, slots: SLOTS });

describe('newCareersFolder', () => {
  test('always sits under the careers prefix', () => {
    expect(newCareersFolder()).toMatch(new RegExp(`^${CAREERS_PREFIX}/[0-9a-f]{24}$`));
  });

  test('is unguessable and never repeats', () => {
    const seen = new Set(Array.from({ length: 200 }, () => newCareersFolder()));
    expect(seen.size).toBe(200);
  });

  /*
    The prefix is load-bearing far beyond this module: assetScope.js routes it to
    the PRIVATE bucket, and the retention purge, orphan cleanup and audit scripts
    all match on it. A rename here would silently start writing CVs into the
    public bucket, so it is pinned as a literal.
  */
  test('the prefix is exactly the one the private-bucket routing expects', () => {
    expect(CAREERS_PREFIX).toBe('autobacs/careers');
  });
});

describe('extensionFor', () => {
  test('maps each allowlisted video type', () => {
    expect(extensionFor('video', 'video/mp4')).toBe('mp4');
    expect(extensionFor('video', 'video/quicktime')).toBe('mov');
    expect(extensionFor('video', 'video/webm')).toBe('webm');
  });

  test('is case- and whitespace-insensitive', () => {
    expect(extensionFor('video', '  VIDEO/MP4 ')).toBe('mp4');
  });

  test('a document slot accepts PDF only', () => {
    expect(extensionFor('raw', 'application/pdf')).toBe('pdf');
    expect(extensionFor('raw', 'text/html')).toBe('');
    expect(extensionFor('raw', 'application/zip')).toBe('');
    expect(extensionFor('raw', 'image/svg+xml')).toBe('');
  });

  /*
    The slot kinds are separate namespaces on purpose: a PDF is a legitimate
    upload, but not into a video-answer slot.
  */
  test('types do not leak across slot kinds', () => {
    expect(extensionFor('video', 'application/pdf')).toBe('');
    expect(extensionFor('raw', 'video/mp4')).toBe('');
  });

  test('an unknown slot kind accepts nothing', () => {
    expect(extensionFor('image', 'video/mp4')).toBe('');
    expect(extensionFor(undefined, 'application/pdf')).toBe('');
  });

  test('no allowlisted type maps to a script-ish extension', () => {
    const exts = Object.values(CAREERS_UPLOAD_TYPES).flatMap((m) => Object.values(m));
    for (const e of exts) expect(['html', 'htm', 'svg', 'js', 'php', 'sh']).not.toContain(e);
  });
});

describe('buildCareersKey', () => {
  const folder = FOLDER;

  test('derives the extension from the content type, not a filename', () => {
    const key = buildCareersKey({ folder, slot: 'resume', resourceType: 'raw', contentType: 'application/pdf' });
    expect(key).toMatch(new RegExp(`^${folder}/resume-[0-9a-f]{16}\\.pdf$`));
  });

  test('carries the slot so the object is self-describing', () => {
    const key = buildCareersKey({ folder, slot: 'videoTwo', resourceType: 'video', contentType: 'video/mp4' });
    expect(slotFromKey(key)).toBe('videoTwo');
  });

  /*
    Round-trip against a REAL folder rather than a fixture: buildCareersKey and
    slotFromKey encode the key shape independently, so this is what catches one
    of them drifting from the other.
  */
  test('a freshly minted key round-trips through slotFromKey', () => {
    const f = newCareersFolder();
    for (const slot of SLOTS) {
      const ct = slot.resourceType === 'raw' ? 'application/pdf' : 'video/mp4';
      const key = buildCareersKey({ folder: f, slot: slot.key, resourceType: slot.resourceType, contentType: ct });
      expect(slotFromKey(key)).toBe(slot.key);
    }
  });

  test('returns empty for a type the slot does not allow', () => {
    expect(buildCareersKey({ folder, slot: 'resume', resourceType: 'raw', contentType: 'text/html' })).toBe('');
  });

  test('returns empty without a folder — never writes to the bucket root', () => {
    expect(buildCareersKey({ folder: '', slot: 'resume', resourceType: 'raw', contentType: 'application/pdf' })).toBe('');
  });

  test('two files in the same slot never collide', () => {
    const a = buildCareersKey({ folder, slot: 'resume', resourceType: 'raw', contentType: 'application/pdf' });
    const b = buildCareersKey({ folder, slot: 'resume', resourceType: 'raw', contentType: 'application/pdf' });
    expect(a).not.toBe(b);
  });
});

describe('slotFromKey', () => {
  test('reads the slot back out', () => {
    expect(slotFromKey(`${FOLDER}/videoOne-0011223344556677.mp4`)).toBe('videoOne');
  });

  /*
    Anything that is not a key WE minted must return '' rather than a plausible
    slot name, because the caller treats '' as a mismatch. A pasted Cloudinary
    public_id, a path-traversal attempt and a bare folder must all fail closed.
  */
  test.each([
    ['a legacy Cloudinary id', `${CAREERS_PREFIX}/abc/qxwtyz`],
    ['no slot segment',        `${FOLDER}/0011223344556677.mp4`],
    ['a traversal attempt',    `${FOLDER}/../../products/x-0011223344556677.mp4`],
    ['a short nonce',          `${FOLDER}/resume-00ff.pdf`],
    ['a foreign prefix',       'autobacs/products/0123456789abcdef01234567/resume-0011223344556677.pdf'],
    ['an extra path segment',  `${FOLDER}/nested/resume-0011223344556677.pdf`],
    ['empty',                  ''],
    ['not a string',           null],
  ])('fails closed on %s', (_label, key) => {
    expect(slotFromKey(key)).toBe('');
  });
});

describe('buildCareersUploadTargets', () => {
  test('returns one presigned target per file', async () => {
    const out = await build([
      { slot: 'videoOne', contentType: 'video/mp4' },
      { slot: 'resume',   contentType: 'application/pdf' },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ slot: 'videoOne', contentType: 'video/mp4', expiresIn: 900 });
    expect(out[0].uploadUrl).toContain('X-Amz-Signature');
    expect(out[1].key).toMatch(/\/resume-[0-9a-f]{16}\.pdf$/);
  });

  /*
    The single most important assertion in this file. A careers upload aimed at
    the public bucket would give every applicant's CV a permanent, unauthenticated
    address.
  */
  test('every target is signed against the PRIVATE bucket', async () => {
    await build([
      { slot: 'videoOne', contentType: 'video/mp4' },
      { slot: 'videoTwo', contentType: 'video/webm' },
      { slot: 'resume',   contentType: 'application/pdf' },
    ]);
    expect(mockPresignPut).toHaveBeenCalledTimes(3);
    for (const [args] of mockPresignPut.mock.calls) expect(args.scope).toBe('private');
  });

  /*
    A private object has no permanent address. Returning a `url` — as the admin
    path does for public images — is exactly the leak this module is shaped to
    prevent, so its absence is asserted rather than assumed.
  */
  test('never hands back a readable URL for a private object', async () => {
    const out = await build([{ slot: 'resume', contentType: 'application/pdf' }]);
    expect(out[0]).not.toHaveProperty('url');
  });

  test('rejects the whole batch when one file has a bad type', async () => {
    await expect(build([
      { slot: 'videoOne', contentType: 'video/mp4' },
      { slot: 'resume',   contentType: 'text/html' },
    ])).rejects.toMatchObject({ statusCode: 400, isOperational: true, expose: true });
    expect(mockPresignPut).not.toHaveBeenCalled();
  });

  /*
    errorMiddleware replaces any message it does not recognise with "Something
    went wrong", so `expose` is what turns this into an applicant-readable
    reason. The message must also name only OUR constants — never echo the
    client's own string back into a response.
  */
  test('the rejection message is applicant-readable and echoes no client input', async () => {
    await expect(build([{ slot: 'resume', contentType: '<img src=x onerror=alert(1)>' }]))
      .rejects.toThrow('Resume must be a PDF.');
    await expect(build([{ slot: 'videoOne', contentType: 'application/pdf' }]))
      .rejects.toThrow('Video answer 1 must be a video (MP4/MOV/WEBM).');
  });

  test('rejects an unknown slot without quoting it back', async () => {
    const err = await build([{ slot: '../products', contentType: 'video/mp4' }]).catch((e) => e);
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('Unrecognised upload slot.');
    expect(err.message).not.toContain('products');
  });

  /*
    Without this the endpoint is free unauthenticated storage: request the same
    slot repeatedly and every call yields another writable URL.
  */
  test('rejects a repeated slot', async () => {
    await expect(build([
      { slot: 'resume', contentType: 'application/pdf' },
      { slot: 'resume', contentType: 'application/pdf' },
    ])).rejects.toMatchObject({ statusCode: 400 });
    expect(mockPresignPut).not.toHaveBeenCalled();
  });

  test('caps the batch at the number of real slots', async () => {
    expect(MAX_CAREERS_FILES).toBe(SLOTS.length);
    const many = Array.from({ length: 40 }, () => ({ slot: 'resume', contentType: 'application/pdf' }));
    // Over-long batches are truncated first, so this trips the duplicate guard
    // rather than minting 40 URLs — either way, nothing is signed.
    await expect(build(many)).rejects.toMatchObject({ statusCode: 400 });
    expect(mockPresignPut).not.toHaveBeenCalled();
  });

  test.each([
    ['no files',      []],
    ['undefined',     undefined],
    ['not an array',  { slot: 'resume' }],
  ])('returns nothing for %s', async (_label, files) => {
    await expect(build(files)).resolves.toEqual([]);
    expect(mockPresignPut).not.toHaveBeenCalled();
  });

  test('every key stays inside the applicant folder', async () => {
    const out = await build([
      { slot: 'videoOne', contentType: 'video/mp4' },
      { slot: 'support',  contentType: 'application/pdf' },
    ]);
    for (const t of out) expect(t.key.startsWith(`${FOLDER}/`)).toBe(true);
  });
});
