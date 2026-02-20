import elasticsearchService from '../services/elasticsearchService.js';

/**
 * Middleware to sync product changes to Elasticsearch
 */
class ElasticsearchSyncMiddleware {
  /**
   * Sync a product to Elasticsearch after it's saved
   */
  static async syncProduct(req, res, next) {
    try {
      // Skip if Elasticsearch is not connected
      if (!(await elasticsearchService.isConnected())) {
        return next();
      }

      // Get the product from the response locals or request body
      const product = res.locals.product || req.body;
      
      if (product && product._id) {
        // Index the product in Elasticsearch
        await elasticsearchService.indexProduct(product);
      }
    } catch (error) {
      console.error('Error syncing product to Elasticsearch:', error);
      // Don't fail the request if Elasticsearch sync fails
    }
    
    next();
  }

  /**
   * Delete a product from Elasticsearch after it's deleted
   */
  static async deleteProduct(req, res, next) {
    // Skip if Elasticsearch is not connected
    if (!(await elasticsearchService.isConnected())) {
      return next();
    }

    try {
      const productId = req.params.id;
      if (productId) {
        // Delete the product from Elasticsearch
        await elasticsearchService.deleteProduct(productId);
      }
    } catch (error) {
      console.error('Error deleting product from Elasticsearch:', error);
      // Don't fail the request if Elasticsearch sync fails
    }
    
    next();
  }
}

export default ElasticsearchSyncMiddleware;