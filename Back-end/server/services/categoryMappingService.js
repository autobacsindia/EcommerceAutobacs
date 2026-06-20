import categoryRepository from "../repositories/categoryRepository.js";
import { CATEGORY_MAPPING_RULES } from '../import-config.js';

class CategoryMappingService {
  constructor() {
    this.categoryCache = new Map();
    this.initialized = false;
  }

  /**
   * Initialize the category mapping service by loading all categories
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    try {
      const categories = await categoryRepository.find({});

      // Build cache with multiple lookup keys
      categories.forEach(category => {
        // Add by ID
        this.categoryCache.set(category._id.toString(), category);

        // Add by slug
        this.categoryCache.set(category.slug.toLowerCase(), category);

        // Add by name
        this.categoryCache.set(category.name.toLowerCase(), category);

        // Add normalized name (remove special characters)
        const normalizedName = category.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        this.categoryCache.set(normalizedName, category);
      });

      if (process.env.NODE_ENV !== 'test') {
        console.log(`📚 Category mapping service initialized with ${categories.length} categories`);
      }
      this.initialized = true;
    } catch (error) {
      if (process.env.NODE_ENV !== 'test') {
        console.error('❌ Failed to initialize category mapping service:', error.message);
      }
      throw error;
    }
  }

  /**
   * Find a category by various matching strategies.
   *
   * NOTE: This was a duplicate `findCategory` declaration shadowed at runtime by
   * the later definition below (JS keeps the last method of a duplicate name).
   * Renamed to silence no-dupe-class-members with zero behavior change; the live
   * lookups all use the later findCategory(identifier). Reconcile the two during
   * the category-service migration.
   * @param {string} categoryName - The name of the category to find
   * @returns {Object|null} The matched category or null
   */
  findCategoryByName(categoryName) {
    if (!categoryName || typeof categoryName !== 'string') {
      return null;
    }

    const lowerName = categoryName.toLowerCase().trim();

    // 1. Exact match by name
    if (this.categoryCache.has(lowerName)) {
      return this.categoryCache.get(lowerName);
    }

    // 2. Normalized match (remove special characters)
    const normalizedName = lowerName.replace(/[^a-z0-9]/g, '');
    if (this.categoryCache.has(normalizedName)) {
      return this.categoryCache.get(normalizedName);
    }

    // 3. Check direct mappings from config
    const directMapping = CATEGORY_MAPPING_RULES.exact[categoryName];
    if (directMapping) {
      const mappedCategory = this.categoryCache.get(directMapping.toLowerCase());
      if (mappedCategory) {
        return mappedCategory;
      }
    }

    // 4. Pattern-based matching
    for (const rule of CATEGORY_MAPPING_RULES.patterns) {
      if (rule.pattern.test(lowerName)) {
        const patternCategory = this.categoryCache.get(rule.category.toLowerCase());
        if (patternCategory) {
          return patternCategory;
        }
      }
    }

    // 5. Partial matching (find categories that contain the search term)
    for (const [key, category] of this.categoryCache.entries()) {
      if (typeof key === 'string' && key.includes(lowerName)) {
        return category;
      }
    }

    // No match found
    return null;
  }

  /**
   * Get all categories as a map for quick lookup
   * @returns {Map} A map of categories keyed by various identifiers
   */
  getCategoryMap() {
    return new Map(this.categoryCache);
  }

  /**
   * Get category statistics
   * @returns {Object} Statistics about the loaded categories
   */
  getStatistics() {
    return {
      totalCategories: this.categoryCache.size / 4, // Divide by 4 because we store 4 keys per category
      initialized: this.initialized
    };
  }

  /**
   * Create a new category if it doesn't exist
   * @param {string} categoryName - The name of the category to create
   * @returns {Object} The created or existing category
   */
  async createCategory(categoryName, parentId = null, externalId = null) {
    try {
      // Check if category already exists by external ID
      if (externalId) {
        const existingByExt = this.findCategory(`ext_${externalId}`);
        if (existingByExt) return existingByExt;
      }

      // Check if category already exists by name
      const existingCategory = this.findCategory(categoryName);
      if (existingCategory) {
        return existingCategory;
      }

      // Create new category
      const slug = categoryName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      const newCategory = categoryRepository.build({
        name: categoryName,
        slug: slug,
        parent: parentId,
        externalId: externalId,
        isActive: true,
        description: `Auto-created category for ${categoryName}`
      });

      await newCategory.save();

      // Add to cache
      this.categoryCache.set(newCategory._id.toString(), newCategory);
      this.categoryCache.set(newCategory.slug.toLowerCase(), newCategory);
      this.categoryCache.set(newCategory.name.toLowerCase(), newCategory);
      if (externalId) this.categoryCache.set(`ext_${externalId}`, newCategory);
      const normalizedName = newCategory.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      this.categoryCache.set(normalizedName, newCategory);

      console.log(`➕ Created new category: ${categoryName}${parentId ? ' (with parent)' : ''}`);
      return newCategory;
    } catch (error) {
      console.error(`❌ Failed to create category "${categoryName}":`, error.message);
      throw error;
    }
  }

  /**
   * Find category by name, slug, or external ID
   * @param {string|number} identifier - Identifier to look for
   * @returns {Object|null} The found category or null
   */
  findCategory(identifier) {
    if (!identifier) return null;
    const lowerId = identifier.toString().toLowerCase();

    // Check external ID cache if prefixed
    if (lowerId.startsWith('ext_')) {
      return this.categoryCache.get(lowerId) || null;
    }

    return this.categoryCache.get(lowerId) ||
      this.categoryCache.get(lowerId.replace(/[^a-z0-9]/g, '')) ||
      null;
  }

  /**
   * Build a parent-id -> direct-children adjacency map from the cache.
   *
   * The cache stores 4 keys per category (id, slug, name, normalized name), so we
   * iterate only the id-keyed entries to visit each category exactly once and avoid
   * duplicate children. `parent` is a Mongoose ObjectId, so it is normalized to a
   * string before indexing — comparing it with `===` against a string id (as the
   * previous implementation did) always returned false and broke aggregation.
   * @returns {Map<string, Array>} parentId -> array of child category objects
   */
  buildChildIndex() {
    const childIndex = new Map();

    for (const [key, category] of this.categoryCache.entries()) {
      if (!category || !category._id) continue;
      // Only process the canonical id-keyed entry to avoid 4x duplication.
      if (key !== category._id.toString()) continue;
      if (!category.parent) continue;

      const parentId = String(category.parent);
      if (!childIndex.has(parentId)) {
        childIndex.set(parentId, []);
      }
      childIndex.get(parentId).push(category);
    }

    return childIndex;
  }

  /**
   * Get all descendant categories for a given category ID.
   * Iterative BFS with a visited set guards against cycles and re-visits.
   * @param {string} categoryId - The ID of the parent category
   * @returns {Array} Array of all descendant category objects (no duplicates)
   */
  async getChildCategories(categoryId) {
    const childIndex = this.buildChildIndex();
    const descendants = [];
    const visited = new Set([String(categoryId)]);
    const queue = [String(categoryId)];

    while (queue.length > 0) {
      const currentId = queue.shift();
      const children = childIndex.get(currentId) || [];
      for (const child of children) {
        const childId = child._id.toString();
        if (visited.has(childId)) continue; // cycle / diamond guard
        visited.add(childId);
        descendants.push(child);
        queue.push(childId);
      }
    }

    return descendants;
  }

  /**
   * Get all category IDs including child categories (parent + all descendants).
   * @param {string} categoryId - The ID of the parent category
   * @returns {Array} Deduplicated array of category IDs (parent first)
   */
  async getAllCategoryIdsIncludingChildren(categoryId) {
    const rootId = String(categoryId);
    const childCategories = await this.getChildCategories(rootId);

    // Set preserves dedupe; root is included even if it has no children.
    const allCategoryIds = new Set([rootId]);
    childCategories.forEach(child => allCategoryIds.add(child._id.toString()));

    return Array.from(allCategoryIds);
  }

  /**
   * Drop the in-memory cache so the next lookup re-loads from the database.
   * Call this after category create/update/delete so hierarchy changes take
   * effect without a process restart.
   */
  refresh() {
    this.categoryCache.clear();
    this.initialized = false;
  }

  /**
   * Ensure a category exists, creating it if necessary
   * @param {string} categoryName - The name of the category to ensure exists
   * @param {string} overrideSlug - Optional specific slug to use
   * @returns {Object} The category (existing or newly created)
   */
  async ensureCategoryExists(categoryName, overrideSlug = null) {
    try {
      // First try to find existing category
      let category = this.findCategory(categoryName);

      if (!category && overrideSlug) {
        category = this.findCategory(overrideSlug);
      }

      if (!category) {
        // If not found, create it
        const slug = overrideSlug || categoryName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        category = categoryRepository.build({
          name: categoryName,
          slug: slug,
          description: `Auto-created category for ${categoryName}`
        });

        await category.save();

        // Add to cache
        this.categoryCache.set(category._id.toString(), category);
        this.categoryCache.set(category.slug.toLowerCase(), category);
        this.categoryCache.set(category.name.toLowerCase(), category);
        const normalizedName = category.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        this.categoryCache.set(normalizedName, category);

        console.log(`➕ Created new category: ${categoryName} (${slug})`);
      }

      return category;
    } catch (error) {
      console.error(`❌ Error ensuring category exists "${categoryName}":`, error.message);
      throw error;
    }
  }

  /**
   * Pre-seed standard categories from configuration
   */
  async ensureStandardCategories() {
    console.log('🌱 Pre-seeding standard categories...');
    const standardCategories = [
      { name: 'Accessories', slug: 'accessories' },
      { name: 'Exterior', slug: 'exterior' },
      { name: 'Interior', slug: 'interior' },
      { name: 'Performance', slug: 'performance' },
      { name: 'Suspension', slug: 'suspension' },
      { name: 'Lighting', slug: 'lighting' },
      { name: 'Other', slug: 'other' }
    ];

    for (const cat of standardCategories) {
      await this.ensureCategoryExists(cat.name, cat.slug);
    }
    console.log('✅ Standard categories ensured');
  }
}

// Export singleton instance
export default new CategoryMappingService();