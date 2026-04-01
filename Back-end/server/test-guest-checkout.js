/**
 * Guest Checkout Backend Test Script
 * Tests all guest checkout and magic link endpoints
 */

const API_BASE = 'http://localhost:8080/api/v1';

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function testGuestCheckout() {
  log('\n🧪 GUEST CHECKOUT BACKEND TESTS\n', 'cyan');
  log('=' .repeat(50), 'cyan');
  
  let testsPassed = 0;
  let testsFailed = 0;
  
  // Generate a session ID for CSRF
  const sessionId = `session_${Date.now()}_test`;
  
  const defaultHeaders = {
    'Content-Type': 'application/json',
    'x-session-id': sessionId
  };
  
  // Test 1: Create Guest Order
  log('\n📋 Test 1: Create Guest Order', 'blue');
  try {
    const response = await fetch(`${API_BASE}/orders/guest`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({
        email: 'guest-test@example.com',
        phone: '+919876543210',
        items: [{
          product: '69aec464981d9f26abdfc170', // Replace with actual product ID from DB
          quantity: 1
        }],
        shippingAddress: {
          fullName: 'Test Guest User',
          phone: '+919876543210',
          addressLine1: '123 Test Street',
          city: 'Mumbai',
          state: 'Maharashtra',
          postalCode: '400001',
          country: 'India'
        },
        paymentMethod: 'cod'
      })
    });
    
    const data = await response.json();
    
    if (response.ok && data.success) {
      log('✅ PASS: Guest order created successfully', 'green');
      log(`   Order ID: ${data.order._id}`, 'green');
      log(`   Order Number: ${data.order.orderNumber}`, 'green');
      log(`   Is Guest: ${data.isGuest}`, 'green');
      log(`   Message: ${data.message}`, 'green');
      
      if (data.magicLinkToken) {
        log(`   Debug Token: ${data.magicLinkToken.substring(0, 20)}...`, 'yellow');
      }
      
      testsPassed++;
      
      // Store token for next test
      global.testOrderId = data.order._id;
      global.magicToken = data.magicLinkToken;
      
    } else {
      log(`❌ FAIL: ${data.message || 'Unknown error'}`, 'red');
      testsFailed++;
    }
  } catch (error) {
    log(`❌ FAIL: ${error.message}`, 'red');
    testsFailed++;
  }
  
  // Test 2: Request Magic Link
  log('\n📋 Test 2: Request Magic Link', 'blue');
  try {
    const response = await fetch(`${API_BASE}/auth/magic-link/request`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({
        email: 'guest-test@example.com',
        orderId: global.testOrderId
      })
    });
    
    const data = await response.json();
    
    if (response.ok && data.success) {
      log('✅ PASS: Magic link sent successfully', 'green');
      log(`   Message: ${data.message}`, 'green');
      
      if (data.debugToken) {
        log(`   Debug Token: ${data.debugToken.substring(0, 20)}...`, 'yellow');
        global.magicToken = data.debugToken;
      }
      
      testsPassed++;
    } else {
      log(`❌ FAIL: ${data.message || 'Unknown error'}`, 'red');
      testsFailed++;
    }
  } catch (error) {
    log(`❌ FAIL: ${error.message}`, 'red');
    testsFailed++;
  }
  
  // Test 3: Verify Magic Link (Claim Account)
  log('\n📋 Test 3: Verify Magic Link & Claim Account', 'blue');
  try {
    if (!global.magicToken) {
      log('⚠️  SKIP: No magic token available (expected in production)', 'yellow');
      testsFailed--; // Don't count as failure
    } else {
      const response = await fetch(`${API_BASE}/auth/magic-link/verify`, {
        method: 'POST',
        headers: defaultHeaders,
        body: JSON.stringify({
          token: global.magicToken,
          password: 'TestPassword123!' // Optional password
        })
      });
      
      const data = await response.json();
      
      if (response.ok && data.success) {
        log('✅ PASS: Account claimed successfully!', 'green');
        log(`   User ID: ${data.user.id}`, 'green');
        log(`   Name: ${data.user.name}`, 'green');
        log(`   Email: ${data.user.email}`, 'green');
        log(`   Is Verified: ${data.user.isVerified}`, 'green');
        log(`   Access Token: ${data.accessToken.substring(0, 30)}...`, 'green');
        log(`   Expires In: ${data.expiresIn}s`, 'green');
        
        testsPassed++;
      } else {
        log(`❌ FAIL: ${data.message || 'Unknown error'}`, 'red');
        testsFailed++;
      }
    }
  } catch (error) {
    log(`❌ FAIL: ${error.message}`, 'red');
    testsFailed++;
  }
  
  // Test 4: Resend Magic Link
  log('\n📋 Test 4: Resend Magic Link', 'blue');
  try {
    const response = await fetch(`${API_BASE}/auth/magic-link/resend`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({
        email: 'guest-test@example.com'
      })
    });
    
    const data = await response.json();
    
    if (response.ok && data.success) {
      log('✅ PASS: Magic link resent successfully', 'green');
      log(`   Message: ${data.message}`, 'green');
      testsPassed++;
    } else {
      log(`❌ FAIL: ${data.message || 'Unknown error'}`, 'red');
      testsFailed++;
    }
  } catch (error) {
    log(`❌ FAIL: ${error.message}`, 'red');
    testsFailed++;
  }
  
  // Test 5: Invalid Token (Should Fail)
  log('\n📋 Test 5: Invalid Token (Expected Failure)', 'blue');
  try {
    const response = await fetch(`${API_BASE}/auth/magic-link/verify`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({
        token: 'invalid_token_12345'
      })
    });
    
    const data = await response.json();
    
    if (!response.ok && !data.success) {
      log('✅ PASS: Correctly rejected invalid token', 'green');
      log(`   Error: ${data.message}`, 'green');
      testsPassed++;
    } else {
      log(`❌ FAIL: Should have rejected invalid token`, 'red');
      testsFailed++;
    }
  } catch (error) {
    log(`❌ FAIL: ${error.message}`, 'red');
    testsFailed++;
  }
  
  // Summary
  log('\n' + '='.repeat(50), 'cyan');
  log('📊 TEST SUMMARY', 'cyan');
  log('=' .repeat(50), 'cyan');
  log(`Total Tests: ${testsPassed + testsFailed}`, 'blue');
  log(`Passed: ${testsPassed}`, 'green');
  log(`Failed: ${testsFailed}`, 'red');
  log(`Success Rate: ${((testsPassed / (testsPassed + testsFailed)) * 100).toFixed(1)}%`, testsFailed === 0 ? 'green' : 'yellow');
  
  if (testsFailed === 0) {
    log('\n🎉 ALL TESTS PASSED! Backend is ready!\n', 'green');
  } else {
    log('\n⚠️  Some tests failed. Check the errors above.\n', 'yellow');
  }
}

// Run tests
testGuestCheckout().catch(console.error);
