/**
 * JobApplication controller — public submit trust boundary + admin inbox:
 *   - metadata validation (role, required fields, email shape)
 *   - required files enforced; file publicId must live under the careers folder;
 *     each file re-validated against Cloudinary (existence + size cap + format)
 *   - role title snapshot always kept; resolves to an open posting when matched,
 *     null for an open application
 *   - admin list paginates + filters by status; detail returns SIGNED file URLs
 *     (never the stored publicId); status/notes update with validation
 *
 * Cloudinary + the notification queue are mocked (external integrations).
 */

import { jest } from '@jest/globals';

const getCareersResource = jest.fn();
const deleteCareersAsset = jest.fn();
const enqueueNotification = jest.fn();

jest.unstable_mockModule('../../../utils/careersCloudinary.js', () => ({
  CAREERS_FOLDER_BASE: 'autobacs/careers',
  generateCareersUploadSignature: ({ folder }) => ({
    cloudName: 'demo', apiKey: 'k', timestamp: 1, folder, type: 'authenticated', signature: 'sig',
  }),
  getCareersResource,
  deleteCareersAsset,
  signedCareersAssetUrl: (publicId, rt) => `signed:${rt}:${publicId}`,
}));

/*
  R2 is mocked at the provider boundary, not at careersUploadTargets: the point
  of the r2 branch tests below is that the controller wires the REAL target
  builder (private scope, server-chosen folder, slot allowlist), so stubbing that
  module out would test nothing.
*/
const presignPut = jest.fn();
const deleteObject = jest.fn(async () => true);
const headObject = jest.fn(async () => null);
const getObjectHead = jest.fn(async () => Buffer.alloc(0));
jest.unstable_mockModule('../../../services/storage/r2Provider.js', () => ({
  presignPut: (...a) => presignPut(...a),
  presignGet: jest.fn(async () => 'https://r2.example/signed'),
  headObject: (...a) => headObject(...a),
  getObjectHead: (...a) => getObjectHead(...a),
  deleteObjects: jest.fn(async () => ({ deleted: 0, failed: [] })),
  deleteObject: (...a) => deleteObject(...a),
  objectExists: jest.fn(async () => false),
}));

jest.unstable_mockModule('../../../queue/queues.js', () => ({
  enqueueNotification,
  getSearchSyncQueue: () => ({ add: jest.fn() }),
  getNotificationsQueue: () => ({ add: jest.fn() }),
}));

const { default: JobPosting } = await import('../../../models/JobPosting.js');
const { default: JobApplication } = await import('../../../models/JobApplication.js');
const controller = await import('../../../controllers/jobApplicationController.js');

beforeAll(async () => {
  await JobPosting.collection.createIndex({ slug: 1 }, { unique: true });
}, 60_000);

beforeEach(() => {
  getCareersResource.mockReset();
  // Default: valid asset, shaped like Cloudinary's REAL Admin API response.
  // Decoded media (video) carries `format`; `raw` resources (PDFs) do NOT — the
  // extension lives in the public_id instead. The controller must derive the raw
  // format from the id suffix, so the fixtures use `.pdf`-suffixed resume ids.
  getCareersResource.mockImplementation((publicId, rt) =>
    Promise.resolve({ public_id: publicId, bytes: 1000, format: rt === 'raw' ? undefined : 'mp4' }));
  enqueueNotification.mockReset();
  presignPut.mockReset();
  deleteObject.mockReset(); deleteObject.mockResolvedValue(true);
  headObject.mockReset();   headObject.mockResolvedValue(null);
  getObjectHead.mockReset(); getObjectHead.mockResolvedValue(Buffer.alloc(0));
  presignPut.mockImplementation(async ({ key }) => ({
    url: `https://r2.example/${key}?X-Amz-Signature=x`, key, expiresIn: 900,
  }));
  delete process.env.STORAGE_PROVIDER;
});

afterEach(() => { delete process.env.STORAGE_PROVIDER; });

afterEach(async () => {
  await JobApplication.deleteMany({});
  await JobPosting.deleteMany({});
});

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

const F = (publicId) => ({ publicId, url: `https://res/${publicId}` });
const goodFiles = () => ({
  videoOne: F('autobacs/careers/n1/v1'),
  videoTwo: F('autobacs/careers/n1/v2'),
  // Real raw (PDF) public_ids carry the extension — that's where the format lives.
  resume: F('autobacs/careers/n1/cv.pdf'),
});

const baseBody = (over = {}) => ({
  role: 'Marketing Manager',
  fullName: 'Asha K',
  city: 'Bengaluru',
  email: 'asha@example.com',
  whatYouBring: 'I build systems.',
  howFound: 'LinkedIn',
  files: goodFiles(),
  ...over,
});

const reqOf = (body) => ({ body, headers: { 'user-agent': 'jest' }, ip: '127.0.0.1' });

describe('getUploadSignature', () => {
  test('returns a signature scoped to a careers subfolder', async () => {
    const res = mockRes();
    await controller.getUploadSignature(reqOf({}), res);
    expect(res.body.success).toBe(true);
    expect(res.body.folder).toMatch(/^autobacs\/careers\/[a-f0-9]{24}$/);
    expect(res.body.type).toBe('authenticated');
  });
});

describe('submitApplication — validation', () => {
  test('400 without a role', async () => {
    const res = mockRes();
    await controller.submitApplication(reqOf(baseBody({ role: '' })), res);
    expect(res.statusCode).toBe(400);
  });

  test('400 when a required text field is blank', async () => {
    const res = mockRes();
    await controller.submitApplication(reqOf(baseBody({ city: '  ' })), res);
    expect(res.statusCode).toBe(400);
  });

  test('400 on a malformed email', async () => {
    const res = mockRes();
    await controller.submitApplication(reqOf(baseBody({ email: 'nope' })), res);
    expect(res.statusCode).toBe(400);
  });

  test('400 when the resume is missing', async () => {
    const res = mockRes();
    await controller.submitApplication(reqOf(baseBody({ files: { videoOne: F('autobacs/careers/n1/v1'), videoTwo: F('autobacs/careers/n1/v2') } })), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/Resume/i);
  });

  test('400 when a file publicId is outside the careers folder', async () => {
    const res = mockRes();
    await controller.submitApplication(reqOf(baseBody({
      files: { ...goodFiles(), resume: F('autobacs/products/steal-this') },
    })), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/invalid upload reference/i);
  });

  test('400 when Cloudinary cannot verify the upload', async () => {
    getCareersResource.mockResolvedValueOnce(null);
    const res = mockRes();
    await controller.submitApplication(reqOf(baseBody()), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/could not be verified/i);
  });

  test('400 when a video exceeds the 30MB cap', async () => {
    getCareersResource.mockResolvedValueOnce({ bytes: 31 * 1024 * 1024 });
    const res = mockRes();
    await controller.submitApplication(reqOf(baseBody()), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/30MB/);
  });

  test('400 when a raw slot holds a non-PDF (e.g. HTML smuggled as a resume)', async () => {
    // A raw asset's type is judged by the public_id extension (Cloudinary does not
    // decode raw bytes → `format` is undefined). An .html id must be rejected.
    const res = mockRes();
    await controller.submitApplication(reqOf(baseBody({
      files: { ...goodFiles(), resume: F('autobacs/careers/n1/evil.html') },
    })), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/must be a PDF/i);
  });

  test('accepts a raw PDF whose Cloudinary `format` is undefined (regression: format from public_id)', async () => {
    // The exact real-world shape that used to be rejected: raw resource with no
    // `format`, id ending in `.pdf`. Must now pass the format check → 201.
    const res = mockRes();
    await controller.submitApplication(reqOf(baseBody()), res);
    expect(res.statusCode).toBe(201);
  });
});

describe('submitApplication — success', () => {
  test('201, resolves the open posting, persists files, enqueues the alert', async () => {
    await JobPosting.create({ title: 'Marketing Manager', department: 'Marketing', slug: 'marketing-manager', status: 'open' });

    const res = mockRes();
    await controller.submitApplication(reqOf(baseBody()), res);
    expect(res.statusCode).toBe(201);

    const saved = await JobApplication.findOne({ email: 'asha@example.com' });
    expect(saved).not.toBeNull();
    expect(saved.roleTitle).toBe('Marketing Manager');
    expect(saved.posting).not.toBeNull(); // matched the open role
    expect(saved.files.resume.publicId).toBe('autobacs/careers/n1/cv.pdf');
    expect(saved.files.resume.bytes).toBe(1000);
    expect(enqueueNotification).toHaveBeenCalledWith('send-admin-careers-alert', { applicationId: saved._id.toString() });
    // The candidate also gets an acknowledgement.
    expect(enqueueNotification).toHaveBeenCalledWith('send-careers-acknowledgement', { applicationId: saved._id.toString() });
  });

  test('open application (no matching posting) still succeeds with a null posting ref', async () => {
    const res = mockRes();
    await controller.submitApplication(reqOf(baseBody({ role: 'Other / Open Application' })), res);
    expect(res.statusCode).toBe(201);
    const saved = await JobApplication.findOne({ email: 'asha@example.com' });
    expect(saved.roleTitle).toBe('Other / Open Application');
    expect(saved.posting).toBeNull();
  });
});

describe('submitApplication — cannot be manipulated via crafted requests', () => {
  test('privileged fields in the body are ignored (no mass assignment)', async () => {
    // A console/curl attacker tries to self-approve and inject internal fields.
    const res = mockRes();
    await controller.submitApplication(reqOf(baseBody({
      status: 'hired',
      adminNotes: 'approve me',
      _id: '000000000000000000000000',
      posting: '111111111111111111111111',
      createdAt: '1999-01-01',
      meta: { ip: '1.2.3.4' },
    })), res);
    expect(res.statusCode).toBe(201);

    const saved = await JobApplication.findOne({ email: 'asha@example.com' });
    expect(saved.status).toBe('new');            // not 'hired'
    expect(saved.adminNotes).toBe('');           // not injected
    expect(saved.meta.ip).toBe('127.0.0.1');     // server-derived, not '1.2.3.4'
    // posting is resolved server-side from the role title, not the injected id.
    expect(saved.posting).toBeNull();
  });

  test('client-claimed file bytes/url/type are discarded; only the verified publicId + Cloudinary values persist', async () => {
    // Cloudinary says the resume is 1000 bytes; the client lies (999999) and
    // sends a hostile url + resourceType. None of it should be trusted/stored.
    const res = mockRes();
    await controller.submitApplication(reqOf(baseBody({
      files: {
        videoOne: F('autobacs/careers/n1/v1'),
        videoTwo: F('autobacs/careers/n1/v2'),
        resume: { publicId: 'autobacs/careers/n1/cv.pdf', url: 'https://evil.example/x', bytes: 999999, resourceType: 'image' },
      },
    })), res);
    expect(res.statusCode).toBe(201);

    const saved = await JobApplication.findOne({ email: 'asha@example.com' });
    expect(saved.files.resume.bytes).toBe(1000);          // Cloudinary value, not 999999
    expect(saved.files.resume.url).toBe('');              // hostile url never stored
    expect(saved.files.resume.resourceType).toBe('raw');  // server-assigned per slot, not 'image'
  });

  test('a fabricated publicId that does not exist in Cloudinary is rejected', async () => {
    getCareersResource.mockResolvedValue(null); // nothing exists
    const res = mockRes();
    await controller.submitApplication(reqOf(baseBody()), res);
    expect(res.statusCode).toBe(400);
  });
});

describe('admin inbox', () => {
  const seed = (over = {}) => JobApplication.create({
    roleTitle: 'Marketing Manager', fullName: 'A', city: 'C', email: `a${Math.random()}@x.com`,
    whatYouBring: 'x', files: { resume: { publicId: 'autobacs/careers/n/cv', resourceType: 'raw', bytes: 500 } },
    ...over,
  });

  test('list paginates and filters by status', async () => {
    await seed({ status: 'new' });
    await seed({ status: 'reviewing' });
    await seed({ status: 'new' });

    const all = mockRes();
    await controller.listApplications({ query: {} }, all);
    expect(all.body.pagination.total).toBe(3);

    const filtered = mockRes();
    await controller.listApplications({ query: { status: 'new' } }, filtered);
    expect(filtered.body.applications).toHaveLength(2);
  });

  test('detail returns signed file URLs, never the raw publicId', async () => {
    const app = await seed();
    const res = mockRes();
    await controller.getApplication({ params: { id: app._id.toString() } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.application.files.resume.url).toBe('signed:raw:autobacs/careers/n/cv');
  });

  test('update sets status + notes; rejects a bad status; 404 for missing', async () => {
    const app = await seed();

    const ok = mockRes();
    await controller.updateApplication({ params: { id: app._id.toString() }, body: { status: 'shortlisted', adminNotes: 'strong' } }, ok);
    expect(ok.body.application.status).toBe('shortlisted');
    expect(ok.body.application.adminNotes).toBe('strong');

    const bad = mockRes();
    await controller.updateApplication({ params: { id: app._id.toString() }, body: { status: 'nonsense' } }, bad);
    expect(bad.statusCode).toBe(400);

    const missing = mockRes();
    await controller.updateApplication({ params: { id: new JobApplication.base.Types.ObjectId().toString() }, body: {} }, missing);
    expect(missing.statusCode).toBe(404);
  });

  test('enqueues the rejection email when an application becomes rejected', async () => {
    const app = await seed({ status: 'reviewing' });
    const id = app._id.toString();

    const rej = mockRes();
    await controller.updateApplication({ params: { id }, body: { status: 'rejected' } }, rej);
    expect(enqueueNotification).toHaveBeenCalledWith('send-careers-rejection', { applicationId: id });
  });

  test('enqueues for a BACKLOG rejection (already rejected, never emailed) on the next save', async () => {
    // Pre-feature rejections have status:'rejected' but no rejectionEmailedAt.
    const app = await seed({ status: 'rejected', rejectionEmailedAt: null });
    await controller.updateApplication({ params: { id: app._id.toString() }, body: { adminNotes: 'reviewed' } }, mockRes());
    expect(enqueueNotification).toHaveBeenCalledWith('send-careers-rejection', { applicationId: app._id.toString() });
  });

  test('does NOT re-enqueue once the rejection email has been sent (rejectionEmailedAt set)', async () => {
    const app = await seed({ status: 'rejected', rejectionEmailedAt: new Date() });
    await controller.updateApplication({ params: { id: app._id.toString() }, body: { adminNotes: 'note' } }, mockRes());
    expect(enqueueNotification).not.toHaveBeenCalledWith('send-careers-rejection', expect.anything());
  });

  test('does not enqueue a rejection for a non-rejection status change', async () => {
    const app = await seed({ status: 'new' });
    await controller.updateApplication({ params: { id: app._id.toString() }, body: { status: 'shortlisted' } }, mockRes());
    expect(enqueueNotification).not.toHaveBeenCalledWith('send-careers-rejection', expect.anything());
  });
});

/**
 * cleanupOrphanedUploads — the endpoint the careers form calls when a
 * submission fails after its files have already uploaded.
 *
 * It is PUBLIC (the careers form is), so an attacker can call it with any
 * publicId. Two guards make that harmless, and these tests exist mainly to pin
 * them: the id must live under autobacs/careers/, and it must not be referenced
 * by any application. The second is load-bearing — without it this endpoint
 * would let anyone delete a submitted applicant's video answers.
 */
describe('cleanupOrphanedUploads', () => {
  beforeEach(() => {
    deleteCareersAsset.mockReset();
    deleteCareersAsset.mockResolvedValue(true);
  });

  const call = async (publicIds) => {
    const res = mockRes();
    await controller.cleanupOrphanedUploads({ body: { publicIds } }, res);
    return res;
  };

  test('deletes unattached careers uploads', async () => {
    const res = await call(['autobacs/careers/n9/v1', 'autobacs/careers/n9/cv.pdf']);
    expect(res.body).toEqual({ success: true, deleted: 2 });
    expect(deleteCareersAsset).toHaveBeenCalledWith('autobacs/careers/n9/v1', 'video');
  });

  test('REFUSES to delete a file attached to a real application', async () => {
    // The guard that makes a public cleanup endpoint safe.
    await JobApplication.create({
      roleTitle: 'Marketing Manager', fullName: 'Asha K', city: 'Bengaluru',
      email: 'asha@example.com', whatYouBring: 'things', files: goodFiles(),
    });
    const res = await call(['autobacs/careers/n1/v1', 'autobacs/careers/n1/cv.pdf']);
    expect(res.body).toEqual({ success: true, deleted: 0 });
    expect(deleteCareersAsset).not.toHaveBeenCalled();
  });

  test('deletes the unattached ids in a mixed batch and spares the attached one', async () => {
    await JobApplication.create({
      roleTitle: 'Marketing Manager', fullName: 'Asha K', city: 'Bengaluru',
      email: 'asha@example.com', whatYouBring: 'things', files: goodFiles(),
    });
    const res = await call(['autobacs/careers/n1/v1', 'autobacs/careers/nX/stray']);
    expect(res.body.deleted).toBe(1);
    expect(deleteCareersAsset).toHaveBeenCalledWith('autobacs/careers/nX/stray', 'video');
    expect(deleteCareersAsset).not.toHaveBeenCalledWith('autobacs/careers/n1/v1', expect.anything());
  });

  test.each([
    ['a product image', 'autobacs/products/abc'],
    ['a traversal attempt', '../../autobacs/products/abc'],
    ['a near-miss prefix', 'autobacs/careers-public/x'],
    ['the folder base itself', 'autobacs/careers'],
  ])('ignores %s', async (_label, id) => {
    const res = await call([id]);
    expect(res.body).toEqual({ success: true, deleted: 0 });
    expect(deleteCareersAsset).not.toHaveBeenCalled();
  });

  test('caps the batch so it cannot be used for bulk deletion', async () => {
    const ids = Array.from({ length: 30 }, (_, i) => `autobacs/careers/n/f${i}`);
    await call(ids);
    expect(deleteCareersAsset.mock.calls.length).toBeLessThanOrEqual(8);
  });

  test('falls back to the raw resource type when the video delete misses', async () => {
    // The client does not know an asset's resource_type, so both are tried.
    deleteCareersAsset.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const res = await call(['autobacs/careers/n9/cv.pdf']);
    expect(deleteCareersAsset).toHaveBeenNthCalledWith(1, 'autobacs/careers/n9/cv.pdf', 'video');
    expect(deleteCareersAsset).toHaveBeenNthCalledWith(2, 'autobacs/careers/n9/cv.pdf', 'raw');
    expect(res.body.deleted).toBe(1);
  });

  test('a storage failure is reported as not-deleted, never as an error', async () => {
    // Cleanup runs while the applicant is already looking at a failure message;
    // it must not throw and replace it with something worse.
    deleteCareersAsset.mockResolvedValue(false);
    const res = await call(['autobacs/careers/n9/v1']);
    expect(res.body).toEqual({ success: true, deleted: 0 });
  });

  test('a rejected delete promise does not propagate', async () => {
    deleteCareersAsset.mockRejectedValue(new Error('cloudinary down'));
    await expect(call(['autobacs/careers/n9/v1'])).resolves.toMatchObject({ body: { deleted: 0 } });
  });

  test.each([undefined, null, [], 'nope', {}])('handles a malformed body %p', async (publicIds) => {
    const res = await call(publicIds);
    expect(res.body).toEqual({ success: true, deleted: 0 });
  });
});


// ── Upload credentials (provider switch) ─────────────────────────────────────
/*
  One endpoint, two shapes. The client branches on `provider`, so a half-migrated
  deployment is explicit rather than inferred from which fields happen to exist.
  `STORAGE_PROVIDER` is read PER REQUEST — these tests set and unset it around
  each case, which is also the proof that flipping it back is a live rollback
  rather than a redeploy.
*/
describe('getUploadSignature', () => {
  const req = (files) => ({ body: files ? { files } : {} });

  test('defaults to Cloudinary when STORAGE_PROVIDER is unset', async () => {
    const res = mockRes();
    await controller.getUploadSignature(req(), res);
    expect(res.body.provider).toBe('cloudinary');
    expect(res.body.signature).toBe('sig');
    expect(presignPut).not.toHaveBeenCalled();
  });

  test('the Cloudinary folder is server-chosen and unguessable', async () => {
    const a = mockRes(); const b = mockRes();
    await controller.getUploadSignature(req(), a);
    await controller.getUploadSignature(req(), b);
    expect(a.body.folder).toMatch(/^autobacs\/careers\/[0-9a-f]{24}$/);
    expect(a.body.folder).not.toBe(b.body.folder);
  });

  describe('with STORAGE_PROVIDER=r2', () => {
    beforeEach(() => { process.env.STORAGE_PROVIDER = 'r2'; });

    test('returns one presigned target per requested slot', async () => {
      const res = mockRes();
      await controller.getUploadSignature(req([
        { slot: 'videoOne', contentType: 'video/mp4' },
        { slot: 'resume', contentType: 'application/pdf' },
      ]), res);

      expect(res.body.provider).toBe('r2');
      expect(res.body.uploads).toHaveLength(2);
      expect(res.body.uploads[0]).toMatchObject({ slot: 'videoOne', contentType: 'video/mp4' });
      expect(res.body.uploads[0].uploadUrl).toContain('X-Amz-Signature');
      // No Cloudinary credential leaks into the r2 shape.
      expect(res.body.signature).toBeUndefined();
      expect(res.body.apiKey).toBeUndefined();
    });

    /*
      The assertion that matters most: a careers upload signed against the public
      bucket would give every applicant's CV a permanent, unauthenticated address.
    */
    test('signs every target against the PRIVATE bucket', async () => {
      const res = mockRes();
      await controller.getUploadSignature(req([
        { slot: 'videoOne', contentType: 'video/mp4' },
        { slot: 'videoTwo', contentType: 'video/webm' },
        { slot: 'resume', contentType: 'application/pdf' },
        { slot: 'support', contentType: 'application/pdf' },
      ]), res);
      expect(presignPut).toHaveBeenCalledTimes(4);
      for (const [args] of presignPut.mock.calls) expect(args.scope).toBe('private');
    });

    test('keys are confined to a server-chosen applicant folder', async () => {
      const res = mockRes();
      await controller.getUploadSignature(req([{ slot: 'resume', contentType: 'application/pdf' }]), res);
      expect(res.body.folder).toMatch(/^autobacs\/careers\/[0-9a-f]{24}$/);
      expect(res.body.uploads[0].key.startsWith(`${res.body.folder}/`)).toBe(true);
    });

    test('never returns a readable URL for a private object', async () => {
      const res = mockRes();
      await controller.getUploadSignature(req([{ slot: 'resume', contentType: 'application/pdf' }]), res);
      expect(res.body.uploads[0]).not.toHaveProperty('url');
    });

    test('rejects a disallowed type before signing anything', async () => {
      await expect(controller.getUploadSignature(
        req([{ slot: 'resume', contentType: 'text/html' }]), mockRes(),
      )).rejects.toMatchObject({ statusCode: 400, expose: true });
      expect(presignPut).not.toHaveBeenCalled();
    });

    test('a client that sends no files gets no targets', async () => {
      const res = mockRes();
      await controller.getUploadSignature(req(), res);
      expect(res.body).toMatchObject({ provider: 'r2', uploads: [] });
      expect(presignPut).not.toHaveBeenCalled();
    });
  });

  test('flipping STORAGE_PROVIDER back returns the Cloudinary shape again', async () => {
    process.env.STORAGE_PROVIDER = 'r2';
    const r2 = mockRes();
    await controller.getUploadSignature(req([{ slot: 'resume', contentType: 'application/pdf' }]), r2);
    expect(r2.body.provider).toBe('r2');

    process.env.STORAGE_PROVIDER = 'cloudinary';
    const back = mockRes();
    await controller.getUploadSignature(req([{ slot: 'resume', contentType: 'application/pdf' }]), back);
    expect(back.body.provider).toBe('cloudinary');
  });
});


// ── Submitting files that live in R2 ─────────────────────────────────────────
/*
  End-to-end through the controller: the client's JSON is a CLAIM, and the
  controller must re-derive size and format from the bucket. These go through
  the REAL careersAssetStore (only the R2 provider is mocked), so they exercise
  the key-shape guard, the ranged sniff and the stored `provider` together.
*/
describe('submitApplication — R2 files', () => {
  const R2_FOLDER = 'autobacs/careers/0123456789abcdef01234567';
  const r2 = (slot, ext) => ({ publicId: `${R2_FOLDER}/${slot}-0011223344556677.${ext}`, provider: 'r2' });
  const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypisom')]);
  const PDF = Buffer.from('%PDF-1.7\n');

  const r2Files = () => ({
    videoOne: r2('videoOne', 'mp4'),
    videoTwo: r2('videoTwo', 'mp4'),
    resume:   r2('resume', 'pdf'),
  });

  beforeEach(() => {
    headObject.mockResolvedValue({ bytes: 2048 });
    getObjectHead.mockImplementation(async ({ key }) => (key.endsWith('.pdf') ? PDF : MP4));
  });

  test('accepts verified files and stores provider + server-derived size', async () => {
    const res = mockRes();
    await controller.submitApplication({ headers: {}, body: baseBody({ files: r2Files() }) }, res);
    expect(res.statusCode).toBe(201);

    const saved = await JobApplication.findOne({ email: 'asha@example.com' }).lean();
    expect(saved.files.resume).toMatchObject({ provider: 'r2', bytes: 2048, resourceType: 'raw' });
    expect(saved.files.videoOne.provider).toBe('r2');
    // Cloudinary was never consulted for an R2 file.
    expect(getCareersResource).not.toHaveBeenCalled();
  });

  test('the stored size comes from the bucket, not the payload', async () => {
    headObject.mockResolvedValue({ bytes: 999 });
    const files = r2Files();
    files.resume.bytes = 1;             // the client lies
    const res = mockRes();
    await controller.submitApplication({ headers: {}, body: baseBody({ files }) }, res);
    const saved = await JobApplication.findOne({ email: 'asha@example.com' }).lean();
    expect(saved.files.resume.bytes).toBe(999);
  });

  /*
    The substitution the magic-byte check exists to stop. Extension, signed
    Content-Type and the client's own claim all say "PDF"; only the bytes say
    otherwise, and R2 enforces neither of the first two.
  */
  test('REJECTS HTML uploaded to the resume slot', async () => {
    getObjectHead.mockImplementation(async ({ key }) =>
      (key.endsWith('.pdf') ? Buffer.from('<!DOCTYPE html><script>x</script>') : MP4));
    const res = mockRes();
    await controller.submitApplication({ headers: {}, body: baseBody({ files: r2Files() }) }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe('Resume must be a PDF.');
    expect(await JobApplication.countDocuments({})).toBe(0);
  });

  test('REJECTS a file that was never uploaded', async () => {
    headObject.mockResolvedValue(null);
    const res = mockRes();
    await controller.submitApplication({ headers: {}, body: baseBody({ files: r2Files() }) }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/could not be verified/);
  });

  test('REJECTS an oversized video against the store size', async () => {
    headObject.mockResolvedValue({ bytes: 31 * 1024 * 1024 });
    const res = mockRes();
    await controller.submitApplication({ headers: {}, body: baseBody({ files: r2Files() }) }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe('Video answer 1 exceeds the 30MB limit.');
  });

  test('REJECTS attaching one slot\'s object to another slot', async () => {
    const files = r2Files();
    files.videoOne = { publicId: `${R2_FOLDER}/resume-0011223344556677.pdf`, provider: 'r2' };
    const res = mockRes();
    await controller.submitApplication({ headers: {}, body: baseBody({ files }) }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe('Video answer 1: invalid upload reference.');
    expect(headObject).not.toHaveBeenCalled();
  });

  test('REJECTS a foreign key pasted into the payload', async () => {
    const files = r2Files();
    files.resume = { publicId: 'autobacs/products/hero/photo.jpg', provider: 'r2' };
    const res = mockRes();
    await controller.submitApplication({ headers: {}, body: baseBody({ files }) }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe('Resume: invalid upload reference.');
  });

  /*
    Mid-cutover reality: an applicant who uploaded before the flip submits after
    it. Each file is verified against the store IT names, so a mixed submission
    is fine — this is what makes the flip safe for in-flight applications.
  */
  test('accepts a submission that mixes both stores', async () => {
    const files = { ...r2Files(), resume: F('autobacs/careers/n1/cv.pdf') };
    const res = mockRes();
    await controller.submitApplication({ headers: {}, body: baseBody({ files }) }, res);
    expect(res.statusCode).toBe(201);
    const saved = await JobApplication.findOne({ email: 'asha@example.com' }).lean();
    expect(saved.files.videoOne.provider).toBe('r2');
    expect(saved.files.resume.provider).toBe('cloudinary');
  });
});
