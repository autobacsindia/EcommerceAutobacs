/**
 * Clear stale recommendation cache from production Redis
 * This forces the backend to generate fresh similar/complementary products
 */

const API_BASE = 'https://ecommerceautobacs-production.up.railway.app';

async function clearCache() {
  console.log('🗑️  Clearing production recommendation cache...\n');
  console.log(`Backend: ${API_BASE}\n`);
  
  const patterns = [
    'PRODUCT_SIMILAR:*',
    'PRODUCT_COMPLEMENTARY:*',
    'PRODUCT_RECOMMENDATIONS:*'
  ];
  
  for (const pattern of patterns) {
    try {
      const response = await fetch(`${API_BASE}/api/v1/cache/invalidate?pattern=${encodeURIComponent(pattern)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      const status = response.ok ? '✅' : '❌';
      console.log(`${status} ${pattern}: ${response.status}`);
    } catch (error) {
      console.log(`❌ ${pattern}: ${error.message}`);
    }
  }
  
  console.log('\n✅ Cache invalidation requests sent!');
  console.log('\n📝 Next steps:');
  console.log('1. Hard refresh the product page: Ctrl + Shift + R');
  console.log('2. Or open in incognito/private window');
  console.log('3. Check if Similar Products ≠ Frequently Bought Together');
}

clearCache();
