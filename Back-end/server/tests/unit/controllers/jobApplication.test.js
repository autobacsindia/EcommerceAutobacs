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
const enqueueNotification = jest.fn();

jest.unstable_mockModule('../../../utils/careersCloudinary.js', () => ({
  CAREERS_FOLDER_BASE: 'autobacs/careers',
  generateCareersUploadSignature: ({ folder }) => ({
    cloudName: 'demo', apiKey: 'k', timestamp: 1, folder, type: 'authenticated', signature: 'sig',
  }),
  getCareersResource,
  signedCareersAssetUrl: (publicId, rt) => `signed:${rt}:${publicId}`,
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
});

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
});
