/**
 * JobPosting controller — admin CRUD + public read guarantees:
 *   - required-field validation (title, department)
 *   - slug derivation from title + de-duplication on collision
 *   - public list/single expose ONLY open roles, in sortOrder
 *   - status → open stamps publishedAt once; slug is stable unless edited
 *   - seo sub-doc is normalised on write; delete is 404-then-gone
 *
 * Drives the exported handlers with mocked req/res over in-memory Mongo, mirroring
 * the sibling controller suites. Cache invalidation is a fire-and-forget side
 * effect (Redis) and is mocked out so the unit stays hermetic.
 */

import { jest } from '@jest/globals';

jest.unstable_mockModule('../../../middleware/cacheMiddleware.js', () => ({
  invalidateCache: jest.fn(),
}));

const { default: JobPosting } = await import('../../../models/JobPosting.js');
const controller = await import('../../../controllers/jobPostingController.js');

beforeAll(async () => {
  await JobPosting.collection.createIndex({ slug: 1 }, { unique: true });
}, 60_000);

afterEach(async () => {
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

const admin = { id: 'admin1' };

const baseBody = (over = {}) => ({
  title: 'Marketing Manager',
  department: 'Marketing',
  tagline: 'Own the story.',
  experience: '3-5 years exp',
  responsibilities: [' The engine ', '', '  '],
  requirements: ['Prove it'],
  ...over,
});

describe('createPosting — validation + slug', () => {
  test('400 without a title', async () => {
    const res = mockRes();
    await controller.createPosting({ body: { department: 'Marketing' }, user: admin }, res);
    expect(res.statusCode).toBe(400);
  });

  test('400 without a department', async () => {
    const res = mockRes();
    await controller.createPosting({ body: { title: 'X' }, user: admin }, res);
    expect(res.statusCode).toBe(400);
  });

  test('201 derives a slug from the title and trims/drops blank bullets', async () => {
    const res = mockRes();
    await controller.createPosting({ body: baseBody(), user: admin }, res);
    expect(res.statusCode).toBe(201);
    expect(res.body.posting.slug).toBe('marketing-manager');
    // "The engine" survives; the empty/whitespace entries are dropped.
    expect(res.body.posting.responsibilities).toEqual(['The engine']);
  });

  test('duplicate title yields a de-duplicated slug, not a 409', async () => {
    const a = mockRes();
    await controller.createPosting({ body: baseBody(), user: admin }, a);
    const b = mockRes();
    await controller.createPosting({ body: baseBody(), user: admin }, b);
    expect(b.statusCode).toBe(201);
    expect(b.body.posting.slug).toBe('marketing-manager-2');
  });

  test('persists a category and updates it', async () => {
    const created = mockRes();
    await controller.createPosting({ body: baseBody({ category: 'Growth' }), user: admin }, created);
    expect(created.body.posting.category).toBe('Growth');

    const updated = mockRes();
    await controller.updatePosting({ params: { id: created.body.posting._id.toString() }, body: { category: 'Leadership / Executive' } }, updated);
    expect(updated.body.posting.category).toBe('Leadership / Executive');
  });

  test('new roles append to the end of the sort order', async () => {
    const a = mockRes();
    await controller.createPosting({ body: baseBody({ title: 'First' }), user: admin }, a);
    const b = mockRes();
    await controller.createPosting({ body: baseBody({ title: 'Second' }), user: admin }, b);
    expect(b.body.posting.sortOrder).toBeGreaterThan(a.body.posting.sortOrder);
  });
});

describe('public read — open only', () => {
  test('list and single expose open roles and hide draft/closed', async () => {
    await JobPosting.create({ title: 'Open', department: 'Ops', slug: 'open-role', status: 'open', sortOrder: 2 });
    await JobPosting.create({ title: 'Early', department: 'Ops', slug: 'early-role', status: 'open', sortOrder: 1 });
    await JobPosting.create({ title: 'Draft', department: 'Ops', slug: 'draft-role', status: 'draft' });

    const list = mockRes();
    await controller.listOpenPostings({}, list);
    expect(list.body.postings).toHaveLength(2);
    // Ordered by sortOrder ascending.
    expect(list.body.postings[0].slug).toBe('early-role');

    const hit = mockRes();
    await controller.getOpenPostingBySlug({ params: { slug: 'open-role' } }, hit);
    expect(hit.statusCode).toBe(200);

    const miss = mockRes();
    await controller.getOpenPostingBySlug({ params: { slug: 'draft-role' } }, miss);
    expect(miss.statusCode).toBe(404);
  });
});

describe('updatePosting', () => {
  test('going open stamps publishedAt exactly once', async () => {
    const created = mockRes();
    await controller.createPosting({ body: baseBody(), user: admin }, created);
    const id = created.body.posting._id.toString();

    const open = mockRes();
    await controller.updatePosting({ params: { id }, body: { status: 'open' } }, open);
    const firstPublished = open.body.posting.publishedAt;
    expect(firstPublished).toBeTruthy();

    // Toggling away and back does not reset the original publish timestamp.
    await controller.updatePosting({ params: { id }, body: { status: 'closed' } }, mockRes());
    const reopen = mockRes();
    await controller.updatePosting({ params: { id }, body: { status: 'open' } }, reopen);
    expect(new Date(reopen.body.posting.publishedAt).getTime())
      .toBe(new Date(firstPublished).getTime());
  });

  test('slug stays stable across unrelated edits, and normalises when edited', async () => {
    const created = mockRes();
    await controller.createPosting({ body: baseBody(), user: admin }, created);
    const id = created.body.posting._id.toString();

    const edit = mockRes();
    await controller.updatePosting({ params: { id }, body: { tagline: 'New hook' } }, edit);
    expect(edit.body.posting.slug).toBe('marketing-manager');

    const reslug = mockRes();
    await controller.updatePosting({ params: { id }, body: { slug: 'Growth Lead!!' } }, reslug);
    expect(reslug.body.posting.slug).toBe('growth-lead');
  });

  test('404 for a missing id', async () => {
    const res = mockRes();
    await controller.updatePosting({ params: { id: new JobPosting.base.Types.ObjectId().toString() }, body: {} }, res);
    expect(res.statusCode).toBe(404);
  });
});

describe('deletePosting', () => {
  test('deletes then 404s on the second call', async () => {
    const created = mockRes();
    await controller.createPosting({ body: baseBody(), user: admin }, created);
    const id = created.body.posting._id.toString();

    const first = mockRes();
    await controller.deletePosting({ params: { id } }, first);
    expect(first.statusCode).toBe(200);

    const second = mockRes();
    await controller.deletePosting({ params: { id } }, second);
    expect(second.statusCode).toBe(404);
  });
});
