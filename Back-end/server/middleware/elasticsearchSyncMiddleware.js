import elasticsearchService from '../services/elasticsearchService.js';

/**
 * Middleware to sync product changes to Elasticsearch
 */
class ElasticsearchSyncMiddleware {
  /**
   * Sync a product to Elasticsearch after it's saved
   */
  static async syncProduct(req, res, next) {
    // Fire and forget - don't await the sync
    const product = res.locals.product || req.body;

    (async () => {
      try {
        if (!(await elasticsearchService.isConnected())) {
          return;
        }
        if (product && product._id) {
          await elasticsearchService.indexProduct(product);
        }
      } catch (error) {
        console.error('[ES] Failed to sync product to Elasticsearch:', {
          productId: product?._id,
          error: error.message,
        });
      }
    })();
    
    // Proceed immediately
    // If headers are not sent yet, next() might be appropriate, but this is a post-response hook usually
    if (!res.headersSent) {
      next();
    }
  }

  /**
   * Delete a product from Elasticsearch after it's deleted
   */
  static deleteProduct(req, res, next) {
    const productId = req.params.id;

    (async () => {
      try {
        if (!(await elasticsearchService.isConnected())) {
          return;
        }
        if (productId) {
          await elasticsearchService.deleteProduct(productId);
        }
      } catch (error) {
        console.error('[ES] Failed to delete product from Elasticsearch:', {
          productId,
          error: error.message,
        });
      }
    })();

    next();
  }
}

export default ElasticsearchSyncMiddleware;