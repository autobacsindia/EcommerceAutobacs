import cron from 'node-cron';
import { syncProducts, syncCategories } from '../services/wordpressSyncService.js';

/**
 * WordPress Sync Cron Job
 * Runs every 10 minutes to sync products and categories from WooCommerce
 */

// Run every 10 minutes
cron.schedule('*/10 * * * *', async () => {
  console.log('[Cron] Starting WordPress product sync...');
  
  try {
    // Sync products first
    const productsResult = await syncProducts();
    
    // Check if sync was skipped (concurrency protection)
    if (!productsResult.success) {
      console.warn(`[Cron] Sync skipped: ${productsResult.message}`);
      return;
    }
    
    console.log(`[Cron] Products synced: ${productsResult.totalSynced} total (${productsResult.totalInserted} new, ${productsResult.totalUpdated} updated, ${productsResult.totalDeleted} deleted)`);
    
    // Then sync categories
    const categoriesResult = await syncCategories();
    console.log(`[Cron] Categories synced: ${categoriesResult.totalSynced} total`);
    
    console.log('[Cron] WordPress sync completed successfully');
    
    // Send success alert to Sentry (optional monitoring)
    try {
      const Sentry = await import('@sentry/node');
      Sentry.captureMessage('WordPress cron sync completed', {
        level: 'info',
        tags: { component: 'wordpress-cron-sync' },
        extra: {
          products: {
            synced: productsResult.totalSynced,
            inserted: productsResult.totalInserted,
            updated: productsResult.totalUpdated,
            deleted: productsResult.totalDeleted
          },
          categories: categoriesResult.totalSynced
        }
      });
    } catch (sentryError) {
      // Sentry not configured, ignore
    }
  } catch (error) {
    console.error('[Cron] WordPress sync failed:', error.message);
    
    // CRITICAL: Send error alert to Sentry for production monitoring
    try {
      const Sentry = await import('@sentry/node');
      Sentry.captureException(error, {
        tags: { component: 'wordpress-sync-cron' },
        level: 'error'
      });
    } catch (sentryError) {
      console.error('[Cron] Sentry alert failed:', sentryError.message);
    }
  }
});

console.log('[Cron] WordPress sync job scheduled (every 10 minutes)');
