import Category from '../models/Category.js';
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
      const categories = await Category.find({});
      
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
      
      console.log(`📚 Category mapping service initialized with ${categories.length} categories`);
      this.initialized = true;
    } catch (error) {
      console.error('❌ Failed to initialize category mapping service:', error.message);
      throw error;
    }
  }

  /**
   * Find a category by various matching strategies
   * @param {string} categoryName - The name of the category to find
   * @returns {Object|null} The matched category or null
   */
  findCategory(categoryName) {
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
  async createCategory(categoryName) {
    try {
      // Check if category already exists
      const existingCategory = this.findCategory(categoryName);
      if (existingCategory) {
        return existingCategory;
      }
      
      // Create new category
      const slug = categoryName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      const newCategory = new Category({
        name: categoryName,
        slug: slug,
        description: `Auto-created category for ${categoryName}`
      });
      
      await newCategory.save();
      
      // Add to cache
      this.categoryCache.set(newCategory._id.toString(), newCategory);
      this.categoryCache.set(newCategory.slug.toLowerCase(), newCategory);
      this.categoryCache.set(newCategory.name.toLowerCase(), newCategory);
      const normalizedName = newCategory.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      this.categoryCache.set(normalizedName, newCategory);
      
      console.log(`➕ Created new category: ${categoryName}`);
      return newCategory;
    } catch (error) {
      console.error(`❌ Failed to create category "${categoryName}":`, error.message);
      throw error;
    }
  }
  
  /**
   * Get all child categories for a given category ID
   * @param {string} categoryId - The ID of the parent category
   * @returns {Array} Array of all child categories
   */
  async getChildCategories(categoryId) {
    const childCategories = [];
    
    // Find direct children
    for (const [key, category] of this.categoryCache.entries()) {
      // Check if this is a category object and has the matching parent
      if (category && category.parent && category.parent === categoryId) {
        childCategories.push(category);
        
        // Recursively get grandchildren
        const grandChildren = await this.getChildCategories(category._id.toString());
        childCategories.push(...grandChildren);
      }
    }
    
    return childCategories;
  }
  
  /**
   * Get all category IDs including child categories
   * @param {string} categoryId - The ID of the parent category
   * @returns {Array} Array of all category IDs including the parent and children
   */
  async getAllCategoryIdsIncludingChildren(categoryId) {
    const allCategoryIds = [categoryId];
    
    // Get child categories
    const childCategories = await this.getChildCategories(categoryId);
    
    // Add child category IDs
    childCategories.forEach(child => {
      allCategoryIds.push(child._id.toString());
    });
    
    return allCategoryIds;
  }
  
  /**
   * Ensure a category exists, creating it if necessary
   * @param {string} categoryName - The name of the category to ensure exists
   * @returns {Object} The category (existing or newly created)
   */
  async ensureCategoryExists(categoryName) {
    try {
      // First try to find existing category
      let category = this.findCategory(categoryName);
      
      if (!category) {
        // If not found, create it
        category = await this.createCategory(categoryName);
      }
      
      return category;
    } catch (error) {
      console.error(`❌ Error ensuring category exists "${categoryName}":`, error.message);
      throw error;
    }
  }
}

// Export singleton instance
export default new CategoryMappingService();