/**
 * CareerCategory controller — admin CRUD guarantees:
 *   - create: name required, case-insensitive dedupe, appends to end
 *   - rename: cascades onto every posting on the old name; blocks name clash
 *   - delete: blocked (409) while any posting still uses the category
 *   - list: returns categories in sortOrder
 *
 * Drives the exported handlers with mocked req/res over in-memory Mongo, mirroring
 * the sibling jobPosting suite. Cache invalidation is mocked out to stay hermetic.
 */

import { jest } from '@jest/globals';

jest.unstable_mockModule('../../../middleware/cacheMiddleware.js', () => ({
  invalidateCache: jest.fn(),
}));

const { default: CareerCategory } = await import('../../../models/CareerCategory.js');
const { default: JobPosting } = await import('../../../models/JobPosting.js');
const controller = await import('../../../controllers/careerCategoryController.js');

beforeAll(async () => {
  await CareerCategory.collection.createIndex({ slug: 1 }, { unique: true });
  await CareerCategory.collection.createIndex(
    { name: 1 },
    { unique: true, collation: { locale: 'en', strength: 2 } },
  );
  await JobPosting.collection.createIndex({ slug: 1 }, { unique: true });
}, 60_000);

afterEach(async () => {
  await CareerCategory.deleteMany({});
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

const makePosting = (over = {}) =>
  JobPosting.create({ title: 'Role', department: 'Dept', slug: `role-${Math.random().toString(36).slice(2)}`, status: 'open', ...over });

describe('createCategory', () => {
  test('400 without a name', async () => {
    const res = mockRes();
    await controller.createCategory({ body: {} }, res);
    expect(res.statusCode).toBe(400);
  });

  test('creates with a derived slug and appends sortOrder', async () => {
    const res1 = mockRes();
    await controller.createCategory({ body: { name: 'Growth' } }, res1);
    expect(res1.statusCode).toBe(201);
    expect(res1.body.category.slug).toBe('growth');

    const res2 = mockRes();
    await controller.createCategory({ body: { name: 'People' } }, res2);
    expect(res2.body.category.sortOrder).toBeGreaterThan(res1.body.category.sortOrder);
  });

  test('409 on a case-insensitive duplicate', async () => {
    await controller.createCategory({ body: { name: 'Growth' } }, mockRes());
    const res = mockRes();
    await controller.createCategory({ body: { name: 'growth' } }, res);
    expect(res.statusCode).toBe(409);
  });

  test('a name with no ASCII alphanumerics still gets a non-empty slug', async () => {
    const res = mockRes();
    await controller.createCategory({ body: { name: '日本 / 技術' } }, res);
    expect(res.statusCode).toBe(201);
    expect(res.body.category.slug).toBe('category'); // slugify() → '' → fallback
    // A second symbol-only name de-dupes rather than colliding on the empty slug.
    const res2 = mockRes();
    await controller.createCategory({ body: { name: '!!!' } }, res2);
    expect(res2.statusCode).toBe(201);
    expect(res2.body.category.slug).toBe('category-2');
  });
});

describe('reorderCategories', () => {
  test('400 when orderedIds is not an array', async () => {
    const res = mockRes();
    await controller.reorderCategories({ body: {} }, res);
    expect(res.statusCode).toBe(400);
  });

  test('assigns sortOrder by position and ignores malformed ids', async () => {
    const a = mockRes(); await controller.createCategory({ body: { name: 'A' } }, a);
    const b = mockRes(); await controller.createCategory({ body: { name: 'B' } }, b);
    const c = mockRes(); await controller.createCategory({ body: { name: 'C' } }, c);

    // Reverse the order, with a junk id mixed in that must be dropped, not throw.
    // ids arrive as JSON strings over the wire, so pass strings here too.
    const id = (r) => String(r.body.category._id);
    const res = mockRes();
    await controller.reorderCategories(
      { body: { orderedIds: [id(c), 'not-an-id', id(b), id(a)] } },
      res,
    );
    expect(res.statusCode).toBe(200);
    const names = res.body.categories.map((cat) => cat.name);
    expect(names).toEqual(['C', 'B', 'A']);
    expect(res.body.categories.map((cat) => cat.sortOrder)).toEqual([0, 1, 2]);
  });
});

describe('updateCategory — rename cascades', () => {
  test('renames the category and every posting that used it', async () => {
    const create = mockRes();
    await controller.createCategory({ body: { name: 'Growth' } }, create);
    const id = create.body.category._id;
    await makePosting({ category: 'Growth' });
    await makePosting({ category: 'Growth' });
    await makePosting({ category: 'People' });

    const res = mockRes();
    await controller.updateCategory({ params: { id }, body: { name: 'Marketing' } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.postingsUpdated).toBe(2);

    const migrated = await JobPosting.countDocuments({ category: 'Marketing' });
    expect(migrated).toBe(2);
    const stalePeople = await JobPosting.countDocuments({ category: 'People' });
    expect(stalePeople).toBe(1);
  });

  test('409 when renaming onto an existing category name', async () => {
    const a = mockRes();
    await controller.createCategory({ body: { name: 'Growth' } }, a);
    await controller.createCategory({ body: { name: 'People' } }, mockRes());

    const res = mockRes();
    await controller.updateCategory({ params: { id: a.body.category._id }, body: { name: 'people' } }, res);
    expect(res.statusCode).toBe(409);
  });
});

describe('deleteCategory — in-use guard', () => {
  test('409 while a posting still uses the category', async () => {
    const create = mockRes();
    await controller.createCategory({ body: { name: 'Growth' } }, create);
    await makePosting({ category: 'Growth' });

    const res = mockRes();
    await controller.deleteCategory({ params: { id: create.body.category._id } }, res);
    expect(res.statusCode).toBe(409);
    expect(res.body.inUse).toBe(1);
  });

  test('deletes when no posting references it', async () => {
    const create = mockRes();
    await controller.createCategory({ body: { name: 'Growth' } }, create);

    const res = mockRes();
    await controller.deleteCategory({ params: { id: create.body.category._id } }, res);
    expect(res.statusCode).toBe(200);
    expect(await CareerCategory.countDocuments({})).toBe(0);
  });
});
