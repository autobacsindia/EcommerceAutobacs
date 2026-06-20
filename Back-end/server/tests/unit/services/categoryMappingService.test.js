import { jest } from '@jest/globals';

// categoryRepository/import-config are only touched by initialize()/createCategory(),
// which these tests never call — they seed the cache directly. Mock the repository so
// importing the module never reaches the database layer.
jest.unstable_mockModule('../../../repositories/categoryRepository.js', () => ({
  default: { find: jest.fn(), build: jest.fn(), findOne: jest.fn() },
}));

const { default: categoryMappingService } = await import(
  '../../../services/categoryMappingService.js'
);

// Simulate a Mongoose ObjectId: a non-string value whose toString() yields the id.
// This is what broke the previous `category.parent === categoryId` strict compare.
const oid = (id) => ({ toString: () => id });

// Build a category and register it under multiple cache keys (id + slug + name) the
// way initialize() does, so dedup behaviour is exercised.
function seed(cache, { id, parent = null, slug, name }) {
  const category = { _id: oid(id), parent: parent ? oid(parent) : null, slug, name };
  cache.set(id, category);
  if (slug) cache.set(slug, category);
  if (name) cache.set(name.toLowerCase(), category);
  return category;
}

describe('categoryMappingService hierarchy aggregation', () => {
  beforeEach(() => {
    categoryMappingService.categoryCache = new Map();
    categoryMappingService.initialized = true;
  });

  function seedTree() {
    const cache = categoryMappingService.categoryCache;
    // Lighting (root) -> Ambient, Fog ; Ambient -> LED Strip ; Audio is unrelated
    seed(cache, { id: 'lighting', parent: null, slug: 'lighting', name: 'Lighting' });
    seed(cache, { id: 'ambient', parent: 'lighting', slug: 'ambient', name: 'Ambient Lights' });
    seed(cache, { id: 'fog', parent: 'lighting', slug: 'fog', name: 'Fog Lights' });
    seed(cache, { id: 'led', parent: 'ambient', slug: 'led', name: 'LED Strip' });
    seed(cache, { id: 'audio', parent: null, slug: 'audio', name: 'Audio' });
  }

  it('returns the full descendant set across the ObjectId boundary', async () => {
    seedTree();
    const children = await categoryMappingService.getChildCategories('lighting');
    const ids = children.map((c) => c._id.toString()).sort();
    expect(ids).toEqual(['ambient', 'fog', 'led']);
  });

  it('does not duplicate categories despite multi-key cache entries', async () => {
    seedTree();
    const ids = await categoryMappingService.getAllCategoryIdsIncludingChildren('lighting');
    // root + 3 descendants, each exactly once
    expect(ids.sort()).toEqual(['ambient', 'fog', 'led', 'lighting']);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('includes the root even when it has no children', async () => {
    seedTree();
    const ids = await categoryMappingService.getAllCategoryIdsIncludingChildren('audio');
    expect(ids).toEqual(['audio']);
  });

  it('terminates on a cyclic hierarchy without infinite recursion', async () => {
    const cache = categoryMappingService.categoryCache;
    seed(cache, { id: 'a', parent: 'b', slug: 'a', name: 'A' });
    seed(cache, { id: 'b', parent: 'a', slug: 'b', name: 'B' });

    const ids = await categoryMappingService.getAllCategoryIdsIncludingChildren('a');
    expect(ids.sort()).toEqual(['a', 'b']);
  });

  it('refresh() clears the cache and forces re-initialization', () => {
    seedTree();
    categoryMappingService.refresh();
    expect(categoryMappingService.categoryCache.size).toBe(0);
    expect(categoryMappingService.initialized).toBe(false);
  });
});
