// WordPress/WooCommerce category import has been retired.
// All category data now lives in MongoDB.
// Use scripts/migrate-from-wordpress.js for any remaining historical migration.

const RETIRED_ERROR = 'WordPress category import has been retired. All category data is managed directly in MongoDB.';

class CategoryImportService {
  constructor() {
    // No-op — WooCommerce dependency removed
  }

  async importCategories() {
    throw new Error(RETIRED_ERROR);
  }

  async importAllCategories() {
    throw new Error(RETIRED_ERROR);
  }

  transformCategoryData() {
    throw new Error(RETIRED_ERROR);
  }
}

export default CategoryImportService;
