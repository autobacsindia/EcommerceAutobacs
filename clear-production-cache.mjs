#!/usr/bin/env node
/**
 * Clear recommendation cache in production
 * Run this to force fresh similar/complementary products
 */

const API_BASE = process.env.BACKEND_URL || 'https://ecommerceautobacs-production.up.railway.app';

async function clearRecommendationCache() {
  console.log('🗑️  Clearing recommendation cache...\n');
  
  try {
    // Clear similar products cache
    const similarResponse = await fetch(`${API_BASE}/api/v1/cache/clear?pattern=PRODUCT_SIMILAR:*`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    
    console.log('Similar products cache:', similarResponse.status === 200 ? '✅ Cleared' : '❌ Failed');
    
    // Clear complementary products cache
    const complementaryResponse = await fetch(`${API_BASE}/api/v1/cache/clear?pattern=PRODUCT_COMPLEMENTARY:*`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    
    console.log('Complementary products cache:', complementaryResponse.status === 200 ? '✅ Cleared' : '❌ Failed');
    
    console.log('\n✅ Cache clearing complete!');
    console.log('💡 Refresh your product page to see fresh recommendations');
    
  } catch (error) {
    console.error('❌ Error clearing cache:', error.message);
    console.log('\n💡 Alternative: Visit product page in incognito mode to bypass browser cache');
  }
}

clearRecommendationCache();
