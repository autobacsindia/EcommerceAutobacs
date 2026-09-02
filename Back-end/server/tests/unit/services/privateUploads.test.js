/**
 * Unit tests — services/storage/privateUploads.js
 *
 * Server-side writes of private artefacts: support-email attachments, courier
 * shipping slips, invoice PDFs. Three properties matter and each fails silently
 * if it breaks:
 *
 *   - R2 writes must land in the PRIVATE bucket. A slip or an invoice in the
 *     public one is a permanent unauthenticated URL to a customer's name,
 *     address and order value;
 *   - the returned ref must carry its provider, because that is the only thing
 *     that later tells a reader or a deleter where to look;
 *   - a delete must be routed by the ref's OWN provider. An S3 delete of a
 *     missing key SUCCEEDS, so a delete aimed at the wrong store reports done
 *     while the object survives.
 */
import { jest } from '@jest/globals';

const putObject = jest.fn();
const deleteObject = jest.fn();
const getObjectBuffer = jest.fn();
jest.unstable_mockModule('../../../services/storage/r2Provider.js', () => ({
  putObject: (...a) => putObject(...a),
  deleteObject: (...a) => deleteObject(...a),
  getObjectBuffer: (...a) => getObjectBuffer(...a),
  presignGet: jest.fn(async () => 'https://r2.example/signed'),
}));

const uploadStream = jest.fn();
const deleteResources = jest.fn();
jest.unstable_mockModule('../../../config/cloudinary.js', () => ({
  default: {
    uploader: { upload_stream: (...a) => uploadStream(...a) },
    api: { delete_resources: (...a) => deleteResources(...a) },
  },
}));

const {
  resourceTypeFor, putPrivateAsset, deletePrivateAsset, readPrivateAsset,
} = await import('../../../services/storage/privateUploads.js');

const PDF = Buffer.from('%PDF-1.7\n');

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.STORAGE_PROVIDER;
  putObject.mockResolvedValue({});
  deleteObject.mockResolvedValue(true);
  deleteResources.mockResolvedValue({ deleted: { 'invoices/x': 'deleted' } });
  // Cloudinary's upload_stream returns a writable; the callback fires on end().
  uploadStream.mockImplementation((opts, cb) => ({
    end: () => cb(null, {
      public_id: `${opts.folder}/${opts.public_id}`,
      bytes: 9,
      secure_url: 'https://res.cloudinary.com/x.pdf',
    }),
  }));
});
afterEach(() => { delete process.env.STORAGE_PROVIDER; });

describe('resourceTypeFor', () => {
  test.each([
    ['image/png', 'image'],
    ['video/mp4', 'video'],
    ['audio/mpeg', 'video'],
    ['application/pdf', 'raw'],
    ['', 'raw'],
    [undefined, 'raw'],
  ])('%s → %s', (mime, expected) => expect(resourceTypeFor(mime)).toBe(expected));
});

describe('putPrivateAsset — R2', () => {
  beforeEach(() => { process.env.STORAGE_PROVIDER = 'r2'; });

  /*
    The assertion that matters most in this file.
  */
  test('writes to the PRIVATE bucket', async () => {
    await putPrivateAsset({
      buffer: PDF, folder: 'shipping-slips', basename: 'slip-1.pdf', contentType: 'application/pdf',
    });
    expect(putObject).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'private', key: 'shipping-slips/slip-1.pdf', contentType: 'application/pdf',
    }));
  });

  test('returns a provider-tagged ref with NO url', async () => {
    const out = await putPrivateAsset({
      buffer: PDF, folder: 'invoices', basename: 'AB-1.pdf', contentType: 'application/pdf',
    });
    // An empty url is the contract, not a failure: a private object has no
    // permanent address, and storing one would hand out an unauthenticated link
    // to a customer's invoice.
    expect(out).toEqual({
      publicId: 'invoices/AB-1.pdf', provider: 'r2', bytes: PDF.length, resourceType: 'raw', url: '',
    });
  });

  test('never touches Cloudinary', async () => {
    await putPrivateAsset({ buffer: PDF, folder: 'invoices', basename: 'a.pdf', contentType: 'application/pdf' });
    expect(uploadStream).not.toHaveBeenCalled();
  });
});

describe('putPrivateAsset — Cloudinary', () => {
  test('keeps each caller\'s existing visibility', async () => {
    // Support attachments are authenticated today; slips and invoices are not.
    // Changing either would 401 every URL already stored in Mongo.
    await putPrivateAsset({
      buffer: PDF, folder: 'autobacs/support/x', basename: 'a.pdf',
      contentType: 'application/pdf', cloudinaryPrivate: true,
    });
    expect(uploadStream.mock.calls[0][0].type).toBe('authenticated');

    await putPrivateAsset({
      buffer: PDF, folder: 'shipping-slips', basename: 'b.pdf', contentType: 'application/pdf',
    });
    expect(uploadStream.mock.calls[1][0].type).toBeUndefined();
  });

  test('returns the stored url and tags the provider', async () => {
    const out = await putPrivateAsset({
      buffer: PDF, folder: 'invoices', basename: 'AB-1.pdf', contentType: 'application/pdf',
    });
    expect(out).toMatchObject({ provider: 'cloudinary', url: 'https://res.cloudinary.com/x.pdf' });
  });

  test('passes overwrite through per caller', async () => {
    await putPrivateAsset({ buffer: PDF, folder: 'invoices', basename: 'a.pdf', contentType: 'application/pdf', overwrite: true });
    expect(uploadStream.mock.calls[0][0].overwrite).toBe(true);
    await putPrivateAsset({ buffer: PDF, folder: 'invoices', basename: 'b.pdf', contentType: 'application/pdf' });
    expect(uploadStream.mock.calls[1][0].overwrite).toBe(false);
  });

  test('rejects an empty buffer rather than storing a zero-byte object', async () => {
    await expect(putPrivateAsset({ buffer: Buffer.alloc(0), folder: 'invoices', basename: 'a.pdf' }))
      .rejects.toMatchObject({ statusCode: 500 });
    await expect(putPrivateAsset({ buffer: PDF, folder: '', basename: 'a.pdf' }))
      .rejects.toMatchObject({ statusCode: 500 });
  });
});

describe('deletePrivateAsset', () => {
  test('an r2 ref deletes from the private bucket', async () => {
    await expect(deletePrivateAsset({ publicId: 'shipping-slips/a.pdf', provider: 'r2' })).resolves.toBe(true);
    expect(deleteObject).toHaveBeenCalledWith({ key: 'shipping-slips/a.pdf', scope: 'private' });
    expect(deleteResources).not.toHaveBeenCalled();
  });

  test('a ref with no provider deletes from Cloudinary', async () => {
    deleteResources.mockResolvedValue({ deleted: { 'shipping-slips/a.pdf': 'deleted' } });
    await expect(deletePrivateAsset({ publicId: 'shipping-slips/a.pdf' })).resolves.toBe(true);
    expect(deleteObject).not.toHaveBeenCalled();
  });

  test('already-gone counts as success so a retried cleanup can finish', async () => {
    deleteResources.mockResolvedValue({ deleted: { 'invoices/a.pdf': 'not_found' } });
    await expect(deletePrivateAsset({ publicId: 'invoices/a.pdf' })).resolves.toBe(true);
  });

  /*
    Reported as not-done, never as done: a caller that records a cleanup which
    never happened leaves a PDF with a customer's address in the bucket with
    nothing referencing it, and no later sweep can attribute it to anyone.
  */
  test('a failed delete is reported as NOT deleted', async () => {
    deleteObject.mockResolvedValue(false);
    await expect(deletePrivateAsset({ publicId: 'invoices/a.pdf', provider: 'r2' })).resolves.toBe(false);
    deleteResources.mockRejectedValue(new Error('network'));
    await expect(deletePrivateAsset({ publicId: 'invoices/b.pdf' })).resolves.toBe(false);
  });

  /*
    These helpers are reachable from request handlers, so an id arriving in a
    payload must never be able to address a product image or an arbitrary object.
  */
  test.each([
    ['a product image',    'autobacs/products/hero.jpg'],
    ['a bare root object', 'anything.pdf'],
    ['a near-miss prefix', 'shipping-slips-evil/a.pdf'],
    ['empty',              ''],
  ])('refuses to delete %s', async (_l, id) => {
    await expect(deletePrivateAsset({ publicId: id, provider: 'r2' })).resolves.toBe(false);
    expect(deleteObject).not.toHaveBeenCalled();
    expect(deleteResources).not.toHaveBeenCalled();
  });
});

describe('readPrivateAsset', () => {
  test('an r2 ref is read straight from the bucket, not over HTTP', async () => {
    getObjectBuffer.mockResolvedValue(PDF);
    const fetchUrl = jest.fn();
    await expect(readPrivateAsset({ publicId: 'shipping-slips/a.pdf', provider: 'r2' }, fetchUrl))
      .resolves.toEqual(PDF);
    // Presigning and then fetching would buy nothing and would put a bearer
    // credential for a customer's paperwork into a log line.
    expect(fetchUrl).not.toHaveBeenCalled();
  });

  test('a Cloudinary ref is fetched from its stored url', async () => {
    const fetchUrl = jest.fn().mockResolvedValue(PDF);
    await readPrivateAsset({ publicId: 'x', url: 'https://res.cloudinary.com/a.pdf' }, fetchUrl);
    expect(fetchUrl).toHaveBeenCalledWith('https://res.cloudinary.com/a.pdf');
  });

  test('throws rather than returning empty bytes when the ref is unusable', async () => {
    await expect(readPrivateAsset({ provider: 'r2' }, jest.fn())).rejects.toThrow();
    await expect(readPrivateAsset({ publicId: 'x' }, jest.fn())).rejects.toThrow();
  });
});
