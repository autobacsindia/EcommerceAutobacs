import WooCommerceApiClient from './woocommerceApiClient.js';
import Category from '../models/Category.js';

class CategoryImportService {
  constructor() {
    this.apiClient = new WooCommerceApiClient();
  }

  /**
   * Transform WooCommerce category data to match our Category model
   * @param {Object} wcCategory - Category data from WooCommerce
   * @returns {Object} Transformed category data
   */
  transformCategoryData(wcCategory) {
    return {
      name: wcCategory.name,
      slug: wcCategory.slug,
      description: wcCategory.description || `Category for ${wcCategory.name}`,
      // Parent will be handled separately after all categories are imported
    };
  }

  /**
   * Find or create category based on WooCommerce category data
   * @param {Object} wcCategory - Category data from WooCommerce
   * @returns {ObjectId} Category ID
   */
  async findOrCreateCategory(wcCategory) {
    try {
      // Try to find existing category by WooCommerce ID (stored in externalId)
      let category = await Category.findOne({ externalId: wcCategory.id });
      
      if (!category) {
        // Try to find existing category by name or slug
        category = await Category.findOne({ 
          $or: [
            { name: wcCategory.name },
            { slug: wcCategory.slug }
          ]
        });
      }
      
      // If not found, create new category
      if (!category) {
        // Ensure slug is unique by appending a counter if needed
        let slug = wcCategory.slug;
        let counter = 1;
        while (await Category.findOne({ slug: slug })) {
          slug = `${wcCategory.slug}-${counter}`;
          counter++;
        }
        
        const categoryData = this.transformCategoryData(wcCategory);
        categoryData.slug = slug;
        categoryData.externalId = wcCategory.id; // Store WooCommerce ID for future reference
        
        category = new Category(categoryData);
        await category.save();
      } else {
        // Update existing category with latest data
        const categoryData = this.transformCategoryData(wcCategory);
        category.name = categoryData.name;
        category.description = categoryData.description;
        category.externalId = wcCategory.id;
        await category.save();
      }
      
      return category._id;
    } catch (error) {
      throw new Error(`Failed to find or create category: ${error.message}`);
    }
  }

  /**
   * Set parent-child relationships for categories
   * @param {Array} wcCategories - WooCommerce categories
   * @param {Map} categoryIdMap - Map of WooCommerce IDs to our category IDs
   */
  async setCategoryParents(wcCategories, categoryIdMap) {
    try {
      for (const wcCategory of wcCategories) {
        // Skip categories without parents
        if (!wcCategory.parent || wcCategory.parent === 0) {
          continue;
        }
        
        // Get our category ID
        const categoryId = categoryIdMap.get(wcCategory.id);
        if (!categoryId) {
          continue;
        }
        
        // Get parent category ID
        const parentCategoryId = categoryIdMap.get(wcCategory.parent);
        if (!parentCategoryId) {
          continue;
        }
        
        // Update category with parent
        await Category.findByIdAndUpdate(categoryId, {
          parent: parentCategoryId
        });
      }
    } catch (error) {
      throw new Error(`Failed to set category parents: ${error.message}`);
    }
  }

  /**
   * Import all categories from WooCommerce
   * @param {Function} progressCallback - Callback to report progress
   * @returns {Object} Import summary
   */
  async importAllCategories(progressCallback = null) {
    try {
      // Fetch all categories from WooCommerce
      const wcCategories = await this.apiClient.fetchAllCategories();
      
      let importedCount = 0;
      let failedCount = 0;
      const categoryIdMap = new Map(); // Map WooCommerce IDs to our category IDs
      
      // Import each category
      for (const wcCategory of wcCategories) {
        try {
          const categoryId = await this.findOrCreateCategory(wcCategory);
          categoryIdMap.set(wcCategory.id, categoryId);
          importedCount++;
          
          // Report progress
          if (progressCallback) {
            progressCallback({
              processed: importedCount + failedCount,
              total: wcCategories.length,
              imported: importedCount,
              failed: failedCount,
              currentCategory: wcCategory.name
            });
          }
        } catch (error) {
          failedCount++;
          console.error(`Failed to import category ${wcCategory.name}:`, error.message);
          
          // Report progress
          if (progressCallback) {
            progressCallback({
              processed: importedCount + failedCount,
              total: wcCategories.length,
              imported: importedCount,
              failed: failedCount,
              currentCategory: wcCategory.name,
              error: error.message
            });
          }
        }
      }
      
      // Set parent-child relationships
      await this.setCategoryParents(wcCategories, categoryIdMap);
      
      return {
        success: true,
        summary: {
          total: wcCategories.length,
          imported: importedCount,
          failed: failedCount
        },
        categoryIdMap
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
}

export default CategoryImportService;