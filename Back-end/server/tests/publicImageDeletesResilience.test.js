/**
 * deleteHostedImages — a failed variant sweep must not strand the original.
 *
 * THE BUG THIS GUARDS
 * --------------------
 * The derivative sweep and the original delete shared one try block, with the
 * original delete LAST. So any error while listing variants — the call
 * throwing, or simply returning nothing iterable — jumped to the catch and the
 * original object was never deleted. By that point the document had already
 * dropped its reference, leaving an object nothing points at and no sweep can
 * attribute: the same permanent-orphan shape that accumulated 1.68 GB on the
 * careers path.
 *
 * It surfaced from a mock whose implementation had been stripped by
 * `resetMocks`, which is exactly how it would surface in production — not as
 * an exception anyone sees, but as a brand logo that quietly stays in the
 * bucket forever after the brand is gone.
 */

import { jest } from '@jest/globals';

const R2_HOST = 'https://img.autobacsindia.com';

const deleteObject = jest.fn();
const deleteObjects = jest.fn();
const listKeys = jest.fn();
const deleteManyFromCloudinary = jest.fn();

const r2Stub = {
  deleteObject, deleteObjects, listKeys,
  putObject: jest.fn(), headObject: jest.fn(), getObjectBuffer: jest.fn(),
  getObjectHead: jest.fn(), objectExists: jest.fn(), presignGet: jest.fn(),
  presignPut: jest.fn(), resetClient: jest.fn(),
};
jest.unstable_mockModule('../services/storage/r2Provider.js', () => ({ ...r2Stub, default: r2Stub }));

const cldStub = {
  deleteManyFromCloudinary,
  uploadToCloudinary: jest.fn(), deleteFromCloudinary: jest.fn(),
  buildOptimizedUrl: jest.fn(), generateUploadSignature: jest.fn(),
  uploadManyToCloudinary: jest.fn(), uploadRawToCloudinary: jest.fn(),
};
jest.unstable_mockModule('../utils/cloudinaryHelpers.js', () => ({ ...cldStub, default: cldStub }));

const { deleteHostedImages } = await import('../services/storage/publicImageDeletes.js');

const KEY = 'autobacs/brands/abc123.png';
const r2Ref = { public_id: KEY, url: `${R2_HOST}/${KEY}` };

let prevBase;
beforeEach(() => {
  prevBase = process.env.R2_PUBLIC_BASE_URL;
  process.env.R2_PUBLIC_BASE_URL = R2_HOST;
  listKeys.mockImplementation(async () => []);
  deleteObject.mockImplementation(async () => {});
  deleteObjects.mockImplementation(async () => ({ deleted: 0 }));
  deleteManyFromCloudinary.mockImplementation(async () => {});
});
afterEach(() => {
  if (prevBase === undefined) delete process.env.R2_PUBLIC_BASE_URL;
  else process.env.R2_PUBLIC_BASE_URL = prevBase;
});

describe('the original is deleted even when the variant sweep fails', () => {
  test('listKeys throwing does not strand the original', async () => {
    listKeys.mockRejectedValue(new Error('R2 list unavailable'));

    await deleteHostedImages([r2Ref]);

    expect(deleteObject).toHaveBeenCalledWith({ key: KEY, scope: 'public' });
  });

  test('listKeys returning nothing iterable does not strand the original', async () => {
    listKeys.mockResolvedValue(undefined);

    await deleteHostedImages([r2Ref]);

    expect(deleteObject).toHaveBeenCalledWith({ key: KEY, scope: 'public' });
  });

  test('a failed variant DELETE does not strand the original', async () => {
    listKeys.mockResolvedValue([{ key: `variants/${KEY}/640.webp` }]);
    deleteObjects.mockRejectedValue(new Error('batch delete failed'));

    await deleteHostedImages([r2Ref]);

    expect(deleteObject).toHaveBeenCalledWith({ key: KEY, scope: 'public' });
  });

  test('never throws — callers are on paths where the DB is already consistent', async () => {
    listKeys.mockRejectedValue(new Error('boom'));
    deleteObject.mockRejectedValue(new Error('boom too'));

    await expect(deleteHostedImages([r2Ref])).resolves.toBeDefined();
  });
});

describe('routing by the ref\'s own url (unchanged behaviour)', () => {
  test('a Cloudinary ref goes to Cloudinary, not R2', async () => {
    await deleteHostedImages([{
      public_id: 'autobacs/brands/old',
      url: 'https://res.cloudinary.com/c/image/upload/v1/autobacs/brands/old.png',
    }]);

    expect(deleteManyFromCloudinary).toHaveBeenCalledWith(['autobacs/brands/old']);
    expect(deleteObject).not.toHaveBeenCalled();
  });

  test('a mixed batch is split between the two stores', async () => {
    await deleteHostedImages([
      r2Ref,
      { public_id: 'autobacs/brands/old', url: 'https://res.cloudinary.com/c/image/upload/v1/x.png' },
    ]);

    expect(deleteObject).toHaveBeenCalledWith({ key: KEY, scope: 'public' });
    expect(deleteManyFromCloudinary).toHaveBeenCalledWith(['autobacs/brands/old']);
  });

  test('a ref with no id is skipped, not guessed at', async () => {
    await deleteHostedImages([{ url: `${R2_HOST}/${KEY}` }]);
    expect(deleteObject).not.toHaveBeenCalled();
    expect(deleteManyFromCloudinary).not.toHaveBeenCalled();
  });
});
