/**
 * The unboxing video's size and type limits (services/returnEvidence.verifyVideo),
 * checked against the STORE — never the browser's claim — on both providers.
 * Cap: 100 MB (config/returnPolicy.VIDEO_MAX_MB).
 */
import { jest } from '@jest/globals';

const mockResource = jest.fn();
jest.unstable_mockModule('../../../utils/returnsCloudinary.js', () => ({
  RETURNS_FOLDER_BASE: 'autobacs/returns',
  generateReturnUploadSignature: () => ({}),
  getReturnResource: (...a) => mockResource(...a),
  signedReturnAssetUrl: async () => 'https://signed.example/x',
  resourceFormat: (resource) => resource.format,
}));
const mockHead = jest.fn();
const mockMagic = jest.fn();
jest.unstable_mockModule('../../../services/storage/r2Provider.js', () => ({
  headObject: (...a) => mockHead(...a),
  getObjectHead: (...a) => mockMagic(...a),
  presignPut: async ({ key }) => ({ url: `https://r2.example/${key}`, key, expiresIn: 900 }),
  presignGet: async () => 'https://r2.example/get',
}));

const { verifyVideo, VIDEO_MAX_BYTES } = await import('../../../services/returnEvidence.js');

const MB = 1024 * 1024;
const CLOUD = { publicId: 'autobacs/returns/abc/unboxing', resourceType: 'video' };
const R2_KEY = 'autobacs/returns/0123456789abcdef01234567/video-0011223344556677.mp4';
const R2 = { publicId: R2_KEY, provider: 'r2', resourceType: 'video' };
// An MP4 starts with a box size then `ftyp`; a PDF with `%PDF-`.
const MP4_MAGIC = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(20)]);
const PDF_MAGIC = Buffer.from('%PDF-1.7\n%âãÏÓ\n', 'latin1');

beforeEach(() => jest.clearAllMocks());

it('the cap is 100 MB', () => {
  expect(VIDEO_MAX_BYTES).toBe(100 * MB);
});

it('no video given is null — the caller decides whether that is allowed', async () => {
  await expect(verifyVideo(undefined)).resolves.toBeNull();
  await expect(verifyVideo({ publicId: '  ' })).resolves.toBeNull();
});

describe('Cloudinary', () => {
  it('accepts an MP4 of exactly 100 MB', async () => {
    mockResource.mockResolvedValue({ bytes: 100 * MB, format: 'mp4' });
    await expect(verifyVideo(CLOUD)).resolves.toMatchObject({ publicId: CLOUD.publicId, bytes: 100 * MB, provider: 'cloudinary' });
  });

  it('rejects a video over 100 MB, whatever the browser said', async () => {
    mockResource.mockResolvedValue({ bytes: 100 * MB + 1, format: 'mov' });
    await expect(verifyVideo({ ...CLOUD, bytes: 1 })).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/100MB limit/) });
  });

  it('rejects a file that is not a video', async () => {
    await expect(verifyVideo({ ...CLOUD, resourceType: 'raw' })).rejects.toMatchObject({ statusCode: 400 });
    mockResource.mockResolvedValue({ bytes: MB, format: 'exe' });
    await expect(verifyVideo(CLOUD)).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/unsupported file type/i) });
  });

  it('rejects a file outside our returns folder, or one that was never uploaded', async () => {
    await expect(verifyVideo({ publicId: 'autobacs/products/x' })).rejects.toMatchObject({ statusCode: 400 });
    mockResource.mockResolvedValue(null);
    await expect(verifyVideo(CLOUD)).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/re-upload/i) });
  });
});

describe('R2', () => {
  it('accepts a real video within the cap', async () => {
    mockHead.mockResolvedValue({ bytes: 80 * MB });
    mockMagic.mockResolvedValue(MP4_MAGIC);
    await expect(verifyVideo(R2)).resolves.toMatchObject({ publicId: R2_KEY, bytes: 80 * MB, provider: 'r2' });
  });

  it('rejects a video over 100 MB', async () => {
    mockHead.mockResolvedValue({ bytes: 150 * MB });
    await expect(verifyVideo(R2)).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/100MB limit/) });
  });

  it('rejects a PDF uploaded into the video slot (checked by its bytes)', async () => {
    mockHead.mockResolvedValue({ bytes: MB });
    mockMagic.mockResolvedValue(PDF_MAGIC);
    await expect(verifyVideo(R2)).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/unsupported file type/i) });
  });

  it('rejects a file minted for a photo slot', async () => {
    const photo = { ...R2, publicId: 'autobacs/returns/0123456789abcdef01234567/photo0-0011223344556677.jpg' };
    await expect(verifyVideo(photo)).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/invalid upload/i) });
  });
});
