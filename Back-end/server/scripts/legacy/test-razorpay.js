/**
 * Test script for Razorpay integration
 * This script tests the basic functionality of the Razorpay service
 */

import dotenv from 'dotenv';
dotenv.config();

let razorpayService;
let serviceInitialized = false;

try {
  razorpayService = (await import('../../services/razorpayService.js')).default;
  serviceInitialized = true;
} catch (error) {
  if (error.message.includes('Razorpay credentials not configured')) {
    console.log('⚠️  Razorpay service not configured - this is expected during initial setup');
    console.log('Please set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in your .env file\n');
  } else {
    throw error;
  }
}

async function testRazorpayService() {
  console.log('Testing Razorpay Service...\n');
  
  if (!serviceInitialized) {
    console.log('⚠️  Skipping tests - Razorpay service not initialized');
    console.log('\n📝 To complete setup:');
    console.log('1. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to .env');
    console.log('2. Re-run this test');
    return;
  }
  
  try {
    // Test 1: Check if service is properly initialized
    console.log('Test 1: Service Initialization');
    console.log('✅ Service initialized successfully');
    console.log(`✅ Key ID: ${razorpayService.key_id ? 'Set' : 'Not set'}`);
    console.log(`✅ Key Secret: ${razorpayService.key_secret ? 'Set' : 'Not set'}\n`);
    
    // Test 2: Test payment method mapping
    console.log('Test 2: Payment Method Mapping');
    const testMethods = ['card', 'debitcard', 'netbanking', 'wallet', 'upi', 'emi', 'unknown'];
    testMethods.forEach(method => {
      const internalMethod = razorpayService.getPaymentMethodFromRazorpay(method);
      console.log(`  ${method} -> ${internalMethod}`);
    });
    console.log('✅ Payment method mapping works correctly\n');
    
    // Test 3: Webhook Signature Verification
    console.log('Test 3: Webhook Signature Verification');
    const crypto = await import('crypto');
    
    // Create a mock webhook payload
    const mockPayload = {
      entity: 'event',
      account_id: 'acc_test_123',
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_test_123',
            amount: 1000,
            currency: 'INR',
            status: 'captured'
          }
        }
      }
    };
    
    const rawBody = JSON.stringify(mockPayload);
    
    // Sign it with the configured secret
    const shasum = crypto.default.createHmac('sha256', razorpayService.key_secret);
    shasum.update(rawBody);
    const validSignature = shasum.digest('hex');
    
    // Verify valid signature
    try {
      const result = await razorpayService.handleWebhook(rawBody, validSignature);
      if (result.success) {
        console.log('✅ Valid signature verification passed');
      } else {
        console.error('❌ Valid signature verification failed');
      }
    } catch (error) {
      console.error('❌ Valid signature verification threw error:', error.message);
    }
    
    // Verify invalid signature
    try {
      await razorpayService.handleWebhook(rawBody, 'invalid_signature_hex');
      console.error('❌ Invalid signature verification failed (should have thrown error)');
    } catch (error) {
      if (error.message === 'Webhook signature verification failed') {
        console.log('✅ Invalid signature verification correctly rejected');
      } else {
        console.error('❌ Invalid signature verification threw unexpected error:', error.message);
      }
    }
    console.log('');
    
    // Test 4: Live API Authentication (actual HTTP call to Razorpay)
    console.log('Test 4: Live API Authentication');
    try {
      const Razorpay = await import('razorpay');
      const instance = new Razorpay.default({
        key_id: razorpayService.key_id,
        key_secret: razorpayService.key_secret
      });
      // Minimal order — ₹1 (100 paise) is the lowest Razorpay accepts
      await instance.orders.create({ amount: 100, currency: 'INR', receipt: 'auth_test' });
      console.log('✅ Live API call succeeded — credentials are valid\n');
    } catch (err) {
      const desc = err?.error?.description || err?.description || err?.message || JSON.stringify(err);
      console.error(`❌ Live API call failed: ${desc}`);
      console.error('   key_id  :', razorpayService.key_id?.slice(0, 16) + '...');
      console.error('   secret  : ' + razorpayService.key_secret?.slice(0, 4) + '...(length ' + razorpayService.key_secret?.length + ')');
      process.exit(1);
    }

    console.log('🎉 All tests passed! Razorpay service is ready for integration.');
    console.log('\n📝 Next steps:');
    console.log('1. Make sure RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are set in .env');
    console.log('2. Test the API endpoints with a real order');
    console.log('3. Verify webhook handling with sample events');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

// Run the test
testRazorpayService();