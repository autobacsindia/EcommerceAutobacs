/**
 * Unit tests — services/storage/r2Provider.js
 *
 * The S3 client is mocked, so these assert OUR logic, not the AWS SDK's:
 * bucket routing, the absent-vs-unavailable distinction, delete idempotency,
 * batch chunking, and the rule that a private object never gets a public URL.
 *
 * The absent-vs-unavailable distinction is the one worth the most care. Callers
 * branch on it in opposite directions — the migration verifier re-copies on
 * "absent" but must halt on "unavailable", and the upload validator rejects on
 * "absent" but must NOT accept on "unavailable". Collapsing the two into a
 * falsy return is how a network blip becomes either a mass re-copy or a
 * silent bypass of server-side size validation.
 */
import { jest } from '@jest/globals';

const mockSend = jest.fn();
const mockGetSignedUrl = jest.fn();

jest.unstable_mockModule('@aws-sdk/client-s3', () => {
  // Command classes are recorded as { __type, ...input } so assertions can read
  // the input without depending on real SDK class internals.
  const cmd = (type) => class { constructor(input) { this.__type = type; this.input = input; } };
  return {
    S3Client: class { send(...a) { return mockSend(...a); } },
    PutObjectCommand:     cmd('Put'),
    GetObjectCommand:     cmd('Get'),
    HeadObjectCommand:    cmd('Head'),
    DeleteObjectCommand:  cmd('Delete'),
    DeleteObjectsCommand: cmd('DeleteMany'),
    ListObjectsV2Command: cmd('List'),
  };
});

jest.unstable_mockModule('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...a) => mockGetSignedUrl(...a),
}));

const r2 = await import('../../../services/storage/r2Provider.js');

const ENV = {
  R2_ACCOUNT_ID: 'acct',
  R2_ACCESS_KEY_ID: 'key',
  R2_SECRET_ACCESS_KEY: 'secret',
  R2_PUBLIC_BUCKET: 'ab-public',
  R2_PRIVATE_BUCKET: 'ab-private',
  R2_PUBLIC_BASE_URL: 'https://img.autobacsindia.com',
};

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(process.env, ENV);
  r2.resetClient();
});

/** Build an SDK-shaped error with an HTTP status, as the real client throws. */
const sdkError = (name, httpStatusCode) => {
  const e = new Error(name);
  e.name = name;
  e.$metadata = { httpStatusCode };
  return e;
};

describe('putObject', () => {
  test('writes to the PUBLIC bucket and returns a delivery URL', async () => {
    mockSend.mockResolvedValue({});
    const r = await r2.putObject({
      body: Buffer.from('x'), key: 'autobacs/products/a.jpg',
      scope: 'public', contentType: 'image/jpeg',
      cacheControl: 'public, max-age=31536000, immutable',
    });
    expect(mockSend.mock.calls[0][0].input).toMatchObject({
      Bucket: 'ab-public',
      Key: 'autobacs/products/a.jpg',
      ContentType: 'image/jpeg',
      CacheControl: 'public, max-age=31536000, immutable',
    });
    expect(r.url).toBe('https://img.autobacsindia.com/autobacs/products/a.jpg');
  });

  test('writes to the PRIVATE bucket and returns NO url', async () => {
    // The structural guarantee: applicant PII has no permanent public address.
    mockSend.mockResolvedValue({});
    const r = await r2.putObject({
      body: Buffer.from('x'), key: 'autobacs/careers/n/cv.pdf', scope: 'private',
    });
    expect(mockSend.mock.calls[0][0].input.Bucket).toBe('ab-private');
    expect(r.url).toBe('');
  });

  test('percent-encodes a key containing a space in the returned URL', async () => {
    mockSend.mockResolvedValue({});
    const r = await r2.putObject({
      body: Buffer.from('x'), key: 'autobacs/vehicle and makes/thar.jpg', scope: 'public',
    });
    expect(r.url).toBe('https://img.autobacsindia.com/autobacs/vehicle%20and%20makes/thar.jpg');
  });

  test('throws with a 500 when the upload fails', async () => {
    mockSend.mockRejectedValue(new Error('connection reset'));
    await expect(r2.putObject({ body: Buffer.from('x'), key: 'k', scope: 'public' }))
      .rejects.toMatchObject({ statusCode: 500 });
  });

  test('rejects an unknown bucket scope rather than guessing', async () => {
    await expect(r2.putObject({ body: Buffer.from('x'), key: 'k', scope: 'sekret' }))
      .rejects.toThrow(/Unknown bucket scope/);
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('requires a key', async () => {
    await expect(r2.putObject({ body: Buffer.from('x'), key: '', scope: 'public' }))
      .rejects.toThrow(/requires a key/);
  });
});

describe('headObject — absent vs unavailable', () => {
  test('returns metadata when the object exists', async () => {
    mockSend.mockResolvedValue({ ContentLength: 2048, ContentType: 'image/jpeg', ETag: '"abc123"' });
    await expect(r2.headObject({ key: 'k', scope: 'public' }))
      .resolves.toEqual({ key: 'k', bytes: 2048, contentType: 'image/jpeg', etag: 'abc123' });
  });

  test.each([
    ['NotFound status 404', sdkError('SomeError', 404)],
    ['NotFound by name',    sdkError('NotFound', undefined)],
    ['NoSuchKey by name',   sdkError('NoSuchKey', undefined)],
  ])('returns null for a genuinely absent object (%s)', async (_label, err) => {
    mockSend.mockRejectedValue(err);
    await expect(r2.headObject({ key: 'k', scope: 'public' })).resolves.toBeNull();
  });

  test.each([
    ['500 server error', sdkError('InternalError', 500)],
    ['403 denied',       sdkError('AccessDenied', 403)],
    ['network failure',  Object.assign(new Error('ETIMEDOUT'), { name: 'TimeoutError' })],
  ])('THROWS when existence cannot be determined (%s)', async (_label, err) => {
    // Must not be mistaken for "absent" — see the file header.
    mockSend.mockRejectedValue(err);
    await expect(r2.headObject({ key: 'k', scope: 'public' })).rejects.toThrow();
  });

  test('objectExists propagates an undeterminable result instead of returning false', async () => {
    mockSend.mockRejectedValue(sdkError('InternalError', 500));
    await expect(r2.objectExists({ key: 'k', scope: 'public' })).rejects.toThrow();
  });

  test('objectExists is false for an absent object', async () => {
    mockSend.mockRejectedValue(sdkError('NotFound', 404));
    await expect(r2.objectExists({ key: 'k', scope: 'public' })).resolves.toBe(false);
  });
});

describe('deleteObject', () => {
  test('returns true on success', async () => {
    mockSend.mockResolvedValue({});
    await expect(r2.deleteObject({ key: 'k', scope: 'public' })).resolves.toBe(true);
  });

  test('returns false and logs [CLEANUP_REQUIRED] on failure — never throws', async () => {
    // A cleanup path that throws turns a retryable orphan into a failed request.
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockSend.mockRejectedValue(new Error('boom'));
    await expect(r2.deleteObject({ key: 'k', scope: 'public' })).resolves.toBe(false);
    expect(spy.mock.calls[0][0]).toMatch(/\[CLEANUP_REQUIRED\]/);
    spy.mockRestore();
  });
});

describe('deleteObjects', () => {
  test('no-ops on an empty list without calling the SDK', async () => {
    await expect(r2.deleteObjects({ keys: [], scope: 'public' }))
      .resolves.toEqual({ deleted: 0, failed: [] });
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('filters out non-string and empty keys', async () => {
    mockSend.mockResolvedValue({ Errors: [] });
    const r = await r2.deleteObjects({ keys: ['a', '', null, undefined, 'b'], scope: 'public' });
    expect(mockSend.mock.calls[0][0].input.Delete.Objects).toEqual([{ Key: 'a' }, { Key: 'b' }]);
    expect(r.deleted).toBe(2);
  });

  test('chunks to the 1000-key S3 batch limit', async () => {
    mockSend.mockResolvedValue({ Errors: [] });
    const keys = Array.from({ length: 2500 }, (_, i) => `k${i}`);
    const r = await r2.deleteObjects({ keys, scope: 'public' });
    expect(mockSend).toHaveBeenCalledTimes(3);
    expect(mockSend.mock.calls[0][0].input.Delete.Objects).toHaveLength(1000);
    expect(mockSend.mock.calls[2][0].input.Delete.Objects).toHaveLength(500);
    expect(r.deleted).toBe(2500);
  });

  test('reports per-key failures without losing the successes', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockSend.mockResolvedValue({ Errors: [{ Key: 'b', Message: 'denied' }] });
    const r = await r2.deleteObjects({ keys: ['a', 'b', 'c'], scope: 'public' });
    expect(r).toEqual({ deleted: 2, failed: ['b'] });
    spy.mockRestore();
  });

  test('a thrown batch marks every key in it failed', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockSend.mockRejectedValue(new Error('network'));
    const r = await r2.deleteObjects({ keys: ['a', 'b'], scope: 'public' });
    expect(r).toEqual({ deleted: 0, failed: ['a', 'b'] });
    spy.mockRestore();
  });
});

describe('presigning', () => {
  beforeEach(() => mockGetSignedUrl.mockResolvedValue('https://signed.example/obj?X-Amz-Signature=x'));

  test('presignPut signs the Content-Type so R2 rejects a mismatched upload', async () => {
    await r2.presignPut({ key: 'k', scope: 'public', contentType: 'image/webp' });
    expect(mockGetSignedUrl.mock.calls[0][1].input)
      .toMatchObject({ Bucket: 'ab-public', Key: 'k', ContentType: 'image/webp' });
  });

  test('presignPut defaults to the configured PUT ttl', async () => {
    process.env.R2_SIGNED_PUT_TTL_SECONDS = '900';
    const r = await r2.presignPut({ key: 'k', scope: 'public', contentType: 'image/jpeg' });
    expect(mockGetSignedUrl.mock.calls[0][2]).toEqual({ expiresIn: 900 });
    expect(r.expiresIn).toBe(900);
  });

  test('presignGet defaults to the PRIVATE bucket and the short GET ttl', async () => {
    process.env.R2_SIGNED_GET_TTL_SECONDS = '300';
    await r2.presignGet({ key: 'autobacs/careers/n/cv.pdf' });
    expect(mockGetSignedUrl.mock.calls[0][1].input.Bucket).toBe('ab-private');
    expect(mockGetSignedUrl.mock.calls[0][2]).toEqual({ expiresIn: 300 });
  });

  test('presignGet sets a download filename when asked', async () => {
    await r2.presignGet({ key: 'k', downloadAs: 'resume.pdf' });
    expect(mockGetSignedUrl.mock.calls[0][1].input.ResponseContentDisposition)
      .toBe('attachment; filename="resume.pdf"');
  });

  test('presignGet strips quotes from the filename so the header cannot be broken out of', async () => {
    await r2.presignGet({ key: 'k', downloadAs: 'a"; x="b.pdf' });
    expect(mockGetSignedUrl.mock.calls[0][1].input.ResponseContentDisposition)
      .toBe('attachment; filename="a; x=b.pdf"');
  });

  test('presignGet returns "" for an empty key rather than signing the bucket root', async () => {
    await expect(r2.presignGet({ key: '' })).resolves.toBe('');
    expect(mockGetSignedUrl).not.toHaveBeenCalled();
  });
});

describe('configuration guard', () => {
  test('throws naming the missing variables when R2 is not configured', async () => {
    delete process.env.R2_ACCESS_KEY_ID;
    delete process.env.R2_PRIVATE_BUCKET;
    r2.resetClient();
    await expect(r2.putObject({ body: Buffer.from('x'), key: 'k', scope: 'public' }))
      .rejects.toThrow(/R2_ACCESS_KEY_ID, R2_PRIVATE_BUCKET/);
  });
});

describe('listKeys', () => {
  test('follows pagination until the listing is complete', async () => {
    mockSend
      .mockResolvedValueOnce({ Contents: [{ Key: 'a', Size: 1 }], IsTruncated: true, NextContinuationToken: 't1' })
      .mockResolvedValueOnce({ Contents: [{ Key: 'b', Size: 2 }], IsTruncated: false });
    await expect(r2.listKeys({ prefix: 'autobacs/', scope: 'public' }))
      .resolves.toEqual([{ key: 'a', bytes: 1 }, { key: 'b', bytes: 2 }]);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });
});
