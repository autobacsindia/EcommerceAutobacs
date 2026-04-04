/**
 * Redis Integration Test Script
 * 
 * Tests Redis connectivity, session management, and monitoring endpoints.
 * Run this after deploying to verify Redis is working correctly.
 */

import fetch from 'node-fetch';

const BASE_URL = process.env.BACKEND_URL || 'http://localhost:8080';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@autobacs.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

console.log('🧪 Testing Redis Integration...\n');
console.log(`Backend URL: ${BASE_URL}\n`);

// Test 1: Health Check
async function testHealthCheck() {
  console.log('Test 1: Health Check Endpoint');
  try {
    const response = await fetch(`${BASE_URL}/health`);
    const data = await response.json();
    
    console.log('  Status:', response.status);
    console.log('  Database:', data.database);
    console.log('  Redis:', data.redis);
    console.log('  Overall Status:', data.status);
    
    if (data.redis === 'connected') {
      console.log('  ✅ PASS: Redis is connected\n');
      return true;
    } else {
      console.log('  ❌ FAIL: Redis is not connected\n');
      return false;
    }
  } catch (err) {
    console.log('  ❌ FAIL:', err.message, '\n');
    return false;
  }
}

// Test 2: Login and Session Creation
async function testSessionCreation() {
  console.log('Test 2: Login & Session Creation');
  try {
    const response = await fetch(`${BASE_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
      }),
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      console.log('  ❌ FAIL: Login failed -', data.message, '\n');
      return null;
    }
    
    console.log('  Login successful');
    console.log('  Access Token:', data.accessToken ? '✅ Received' : '❌ Missing');
    console.log('  Refresh Token Cookie:', response.headers.get('set-cookie') ? '✅ Set' : '❌ Not set');
    console.log('  ✅ PASS: Session created\n');
    
    return data.accessToken;
  } catch (err) {
    console.log('  ❌ FAIL:', err.message, '\n');
    return null;
  }
}

// Test 3: Redis Stats (Admin Only)
async function testRedisStats(token) {
  if (!token) {
    console.log('Test 3: Redis Stats - SKIPPED (no token)\n');
    return;
  }
  
  console.log('Test 3: Redis Statistics');
  try {
    const response = await fetch(`${BASE_URL}/api/v1/admin/redis/stats`, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      console.log('  ❌ FAIL:', data.error || data.message, '\n');
      return;
    }
    
    console.log('  Connected:', data.connected);
    console.log('  Uptime:', data.uptime ? `${data.uptime}s` : 'N/A');
    console.log('  Memory:', data.usedMemory || 'N/A');
    console.log('  Session Keys:', data.sessionKeys || 0);
    console.log('  Cache Hit Rate:', data.cache?.hitRate || 'N/A');
    console.log('  ✅ PASS: Redis stats retrieved\n');
  } catch (err) {
    console.log('  ❌ FAIL:', err.message, '\n');
  }
}

// Test 4: Redis Health
async function testRedisHealth(token) {
  if (!token) {
    console.log('Test 4: Redis Health - SKIPPED (no token)\n');
    return;
  }
  
  console.log('Test 4: Redis Health Check');
  try {
    const response = await fetch(`${BASE_URL}/api/v1/admin/redis/health`, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      console.log('  ❌ FAIL:', data.error || data.message, '\n');
      return;
    }
    
    console.log('  Healthy:', data.healthy);
    console.log('  Redis Status:', data.redis);
    
    if (data.healthy) {
      console.log('  ✅ PASS: Redis is healthy\n');
    } else {
      console.log('  ⚠️  WARNING: Redis health check failed\n');
    }
  } catch (err) {
    console.log('  ❌ FAIL:', err.message, '\n');
  }
}

// Main test runner
async function runTests() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  // Test 1: Health check
  const healthPassed = await testHealthCheck();
  
  // Test 2: Login
  const token = await testSessionCreation();
  
  // Test 3: Redis stats
  await testRedisStats(token);
  
  // Test 4: Redis health
  await testRedisHealth(token);
  
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('📊 Summary:');
  console.log('  - Health Check:', healthPassed ? '✅ PASS' : '❌ FAIL');
  console.log('  - Session Creation:', token ? '✅ PASS' : '❌ FAIL');
  console.log('  - Redis Stats:', token ? '✅ Tested' : '⏭️  Skipped');
  console.log('  - Redis Health:', token ? '✅ Tested' : '⏭️  Skipped');
  console.log('\n🎯 Next Steps:');
  console.log('  1. If all tests pass → Redis is ready for production');
  console.log('  2. If health check fails → Check REDIS_URL in Railway');
  console.log('  3. If login fails → Verify admin credentials');
  console.log('  4. Deploy to Railway and re-run tests\n');
}

// Run tests
runTests().catch(err => {
  console.error('💥 Test runner error:', err);
  process.exit(1);
});
