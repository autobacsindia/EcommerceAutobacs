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

  // The slug twin of the id resolver. Elasticsearch documents carry
  // `categories.slug` and no ObjectId, so this is the only way an ES filter can
  // cover the same subtree the Mongo filter does. When it did not exist, ES
  // compared the URL slug against the display NAME, matched nothing, and every
  // category page fell through to a full Mongo scan.
  describe('getAllCategorySlugsIncludingChildren', () => {
    it('returns the root slug plus every descendant slug, deduplicated', async () => {
      seedTree();
      const slugs = await categoryMappingService.getAllCategorySlugsIncludingChildren('lighting');
      expect(slugs.sort()).toEqual(['ambient', 'fog', 'led', 'lighting']);
      expect(new Set(slugs).size).toBe(slugs.length);
    });

    it('walks the same subtree as the id resolver', async () => {
      seedTree();
      const ids = await categoryMappingService.getAllCategoryIdsIncludingChildren('lighting');
      const slugs = await categoryMappingService.getAllCategorySlugsIncludingChildren('lighting');
      // Parity is the entire contract: one product set, two filter languages.
      expect(slugs).toHaveLength(ids.length);
    });

    it('resolves from a slug seed, not just an id', async () => {
      seedTree();
      // This is what the storefront actually sends — a slug in the URL.
      const slugs = await categoryMappingService.getAllCategorySlugsIncludingChildren('lighting');
      expect(slugs).toContain('lighting');
      expect(slugs).toContain('led');
    });

    it('includes the root even when it has no children', async () => {
      seedTree();
      expect(await categoryMappingService.getAllCategorySlugsIncludingChildren('audio'))
        .toEqual(['audio']);
    });

    it('skips categories with no slug rather than emitting undefined', async () => {
      // An undefined entry in a terms filter matches nothing and would silently
      // narrow the result set instead of failing loudly.
      const cache = categoryMappingService.categoryCache;
      seed(cache, { id: 'root', parent: null, slug: 'root', name: 'Root' });
      const orphan = { _id: oid('noslug'), parent: oid('root'), slug: null, name: 'No Slug' };
      cache.set('noslug', orphan);

      const slugs = await categoryMappingService.getAllCategorySlugsIncludingChildren('root');
      expect(slugs).toEqual(['root']);
      expect(slugs).not.toContain(undefined);
    });

    it('terminates on a cyclic hierarchy', async () => {
      const cache = categoryMappingService.categoryCache;
      seed(cache, { id: 'a', parent: 'b', slug: 'a', name: 'A' });
      seed(cache, { id: 'b', parent: 'a', slug: 'b', name: 'B' });
      expect((await categoryMappingService.getAllCategorySlugsIncludingChildren('a')).sort())
        .toEqual(['a', 'b']);
    });
  });

  it('refresh() clears the cache and forces re-initialization', () => {
    seedTree();
    categoryMappingService.refresh();
    expect(categoryMappingService.categoryCache.size).toBe(0);
    expect(categoryMappingService.initialized).toBe(false);
  });
});
