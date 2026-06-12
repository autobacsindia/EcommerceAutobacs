// WordPress/WooCommerce import has been retired.
// All product data now lives in MongoDB.
// Use scripts/migrate-from-wordpress.js for any remaining historical migration.

const RETIRED_ERROR = 'WordPress import has been retired. All product data is managed directly in MongoDB.';

class ProductImportService {
  constructor() {
    // No-op — WooCommerce dependency removed
  }

  async importAllProducts() {
    throw new Error(RETIRED_ERROR);
  }

  async findMissingWordPressProducts() {
    throw new Error(RETIRED_ERROR);
  }

  async previewImport() {
    throw new Error(RETIRED_ERROR);
  }

  async fetchProductsFromWordPress() {
    throw new Error(RETIRED_ERROR);
  }

  async getTotalProductCount() {
    throw new Error(RETIRED_ERROR);
  }

  transformProductData() {
    throw new Error(RETIRED_ERROR);
  }
}

export default ProductImportService;
