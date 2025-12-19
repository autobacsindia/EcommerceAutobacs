import axios from 'axios';

class WooCommerceApiClient {
  constructor() {
    this.wordpressSiteUrl = process.env.WORDPRESS_SITE_URL;
    this.wordpressApiKey = process.env.WORDPRESS_API_KEY;
    this.wordpressApiSecret = process.env.WORDPRESS_API_SECRET;
    this.wordpressApiVersion = process.env.WORDPRESS_API_VERSION || 'wc/v3';
    
    // Validate required configuration
    if (!this.wordpressSiteUrl || !this.wordpressApiKey || !this.wordpressApiSecret) {
      throw new Error('Missing required WordPress API configuration');
    }
    
    // Remove trailing slash from site URL if present
    this.wordpressSiteUrl = this.wordpressSiteUrl.replace(/\/$/, '');
  }

  /**
   * Make an authenticated request to the WooCommerce API
   * @param {string} endpoint - API endpoint (e.g., 'products', 'products/categories')
   * @param {Object} params - Query parameters
   * @returns {Promise} Axios response promise
   */
  async makeRequest(endpoint, params = {}) {
    const url = `${this.wordpressSiteUrl}/wp-json/${this.wordpressApiVersion}/${endpoint}`;
    
    try {
      const response = await axios.get(url, {
        auth: {
          username: this.wordpressApiKey,
          password: this.wordpressApiSecret
        },
        params: {
          ...params
        },
        timeout: 30000 // 30 second timeout
      });
      
      return response;
    } catch (error) {
      throw new Error(`Failed to make request to ${endpoint}: ${error.message}`);
    }
  }

  /**
   * Fetch products from WooCommerce with pagination
   * @param {number} page - Page number
   * @param {number} perPage - Number of products per page (max 100)
   * @returns {Promise<Array>} Array of products
   */
  async fetchProducts(page = 1, perPage = 100) {
    try {
      const response = await this.makeRequest('products', {
        page,
        per_page: Math.min(perPage, 100), // WooCommerce max is 100
        status: 'publish' // Only fetch published products
      });
      
      return response.data;
    } catch (error) {
      throw new Error(`Failed to fetch products: ${error.message}`);
    }
  }

  /**
   * Fetch all products with automatic pagination
   * @param {Function} progressCallback - Callback to report progress
   * @returns {Promise<Array>} All products
   */
  async fetchAllProducts(progressCallback = null) {
    try {
      const allProducts = [];
      let page = 1;
      let totalPages = 1;
      
      do {
        const response = await this.makeRequest('products', {
          page,
          per_page: 100,
          status: 'publish'
        });
        
        // Get total pages from headers
        const totalPagesHeader = response.headers['x-wp-totalpages'];
        totalPages = totalPagesHeader ? parseInt(totalPagesHeader) : 1;
        
        // Add products to array
        allProducts.push(...response.data);
        
        // Report progress if callback provided
        if (progressCallback) {
          progressCallback({
            page,
            totalPages,
            productsFetched: allProducts.length
          });
        }
        
        page++;
        
        // Small delay to prevent overwhelming the API
        if (page <= totalPages) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } while (page <= totalPages);
      
      return allProducts;
    } catch (error) {
      throw new Error(`Failed to fetch all products: ${error.message}`);
    }
  }

  /**
   * Get total number of products
   * @returns {Promise<number>} Total product count
   */
  async getProductCount() {
    try {
      const response = await this.makeRequest('products', {
        per_page: 1
      });
      
      // Get total count from headers
      const totalCount = response.headers['x-wp-total'] || response.data.length;
      return parseInt(totalCount);
    } catch (error) {
      throw new Error(`Failed to get product count: ${error.message}`);
    }
  }

  /**
   * Fetch categories from WooCommerce with pagination
   * @param {number} page - Page number
   * @param {number} perPage - Number of categories per page (max 100)
   * @returns {Promise<Array>} Array of categories
   */
  async fetchCategories(page = 1, perPage = 100) {
    try {
      const response = await this.makeRequest('products/categories', {
        page,
        per_page: Math.min(perPage, 100), // WooCommerce max is 100
        hide_empty: false // Include categories even if they have no products
      });
      
      return response.data;
    } catch (error) {
      throw new Error(`Failed to fetch categories: ${error.message}`);
    }
  }

  /**
   * Fetch all categories with automatic pagination
   * @param {Function} progressCallback - Callback to report progress
   * @returns {Promise<Array>} All categories
   */
  async fetchAllCategories(progressCallback = null) {
    try {
      const allCategories = [];
      let page = 1;
      let totalPages = 1;
      
      do {
        const response = await this.makeRequest('products/categories', {
          page,
          per_page: 100,
          hide_empty: false
        });
        
        // Get total pages from headers
        const totalPagesHeader = response.headers['x-wp-totalpages'];
        totalPages = totalPagesHeader ? parseInt(totalPagesHeader) : 1;
        
        // Add categories to array
        allCategories.push(...response.data);
        
        // Report progress if callback provided
        if (progressCallback) {
          progressCallback({
            page,
            totalPages,
            categoriesFetched: allCategories.length
          });
        }
        
        page++;
        
        // Small delay to prevent overwhelming the API
        if (page <= totalPages) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } while (page <= totalPages);
      
      return allCategories;
    } catch (error) {
      throw new Error(`Failed to fetch all categories: ${error.message}`);
    }
  }

  /**
   * Get total number of categories
   * @returns {Promise<number>} Total category count
   */
  async getCategoryCount() {
    try {
      const response = await this.makeRequest('products/categories', {
        per_page: 1
      });
      
      // Get total count from headers
      const totalCount = response.headers['x-wp-total'] || response.data.length;
      return parseInt(totalCount);
    } catch (error) {
      throw new Error(`Failed to get category count: ${error.message}`);
    }
  }
}

export default WooCommerceApiClient;