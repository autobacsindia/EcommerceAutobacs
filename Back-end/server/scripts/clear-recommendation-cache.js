/**
 * Clear stale similar and complementary product caches
 * Run this when you notice duplicate products in recommendations
 * 
 * Usage: npm run clear-recommendation-cache
 */

import cacheService from '../services/cacheService.js';

async function clearRecommendationCache() {
  console.log('🧹 Clearing stale recommendation caches...\n');

  try {
    // Try to clear all cache (simplest approach)
    if (cacheService.clear) {
      console.log('📊 Clearing entire cache (simplest and most reliable method)\n');
      await cacheService.clear();
      console.log('✅ Cache cleared successfully!\n');
      console.log('💡 The next page load will fetch fresh data from the database\n');
    } else {
      console.log('⚠️  Cache clear method not available');
      console.log('💡 Please restart the backend server to clear the cache\n');
      console.log('   Command: cd Back-end/server && npm run dev\n');
    }
  } catch (error) {
    console.error('❌ Error clearing cache:', error.message);
    console.error('💡 Please restart the backend server manually\n');
    process.exit(1);
  }

  process.exit(0);
}

// Run the script
clearRecommendationCache();

