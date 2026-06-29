/**
 * Test Order Status Transitions
 * Tests the order status service and transition validation
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import orderStatusService, { STATUS_TRANSITIONS } from '../../services/orderStatusService.js';
import Order from '../../models/Order.js';
import User from '../../models/User.js';
import Product from '../../models/Product.js';
import Category from '../../models/Category.js';

dotenv.config();

// Test data
let testOrder;
let testUser;
let testProduct;

/**
 * Connect to MongoDB
 */
async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/autobacs');
    console.log('✓ Connected to MongoDB');
  } catch (error) {
    console.error('✗ MongoDB connection error:', error.message);
    process.exit(1);
  }
}

/**
 * Create test data
 */
async function createTestData() {
  try {
    console.log('\n--- Creating Test Data ---');
    
    // Create test user
    testUser = await User.findOne({ email: 'test@example.com' });
    if (!testUser) {
      testUser = await User.create({
        name: 'Test User',
        email: 'test@example.com',
        password: 'password123',
        role: 'customer'
      });
    }
    console.log('✓ Test user created/found:', testUser.email);

    // Create test product
    testProduct = await Product.findOne({ name: 'Test Product' });
    if (!testProduct) {
      // First, find or create a test category
      let testCategory = await Category.findOne({ name: 'Test Category' });
      if (!testCategory) {
        testCategory = await Category.create({
          name: 'Test Category',
          slug: 'test-category',
          description: 'Test category for order status testing',
          isActive: true
        });
      }

      testProduct = await Product.create({
        name: 'Test Product',
        description: 'Test product for order status testing',
        price: 1000,
        stock: 100,
        category: testCategory._id,
        brand: 'Test Brand',
        isActive: true
      });
    }
    console.log('✓ Test product created/found:', testProduct.name);

    // Create test order
    testOrder = await Order.create({
      user: testUser._id,
      items: [{
        product: testProduct._id,
        quantity: 2,
        price: testProduct.price,
        name: testProduct.name
      }],
      shippingAddress: {
        fullName: 'Test User',
        phone: '1234567890',
        addressLine1: '123 Test St',
        city: 'Test City',
        state: 'Test State',
        postalCode: '12345'
      },
      subtotal: 2000,
      totalAmount: 2000,
      status: 'pending'
    });
    console.log('✓ Test order created:', testOrder._id);

  } catch (error) {
    console.error('✗ Error creating test data:', error.message);
    throw error;
  }
}

/**
 * Test 1: Validate Status Transitions
 */
async function testStatusTransitions() {
  console.log('\n--- Test 1: Status Transition Validation ---');
  
  const tests = [
    { from: 'pending', to: 'confirmed', isAdmin: false, expected: true },
    { from: 'pending', to: 'cancelled', isAdmin: false, expected: true },
    { from: 'pending', to: 'shipped', isAdmin: false, expected: false },
    { from: 'confirmed', to: 'processing', isAdmin: false, expected: true },
    { from: 'confirmed', to: 'cancelled', isAdmin: false, expected: true },
    { from: 'processing', to: 'shipped', isAdmin: false, expected: true },
    { from: 'processing', to: 'cancelled', isAdmin: false, expected: false }, // Requires admin
    { from: 'processing', to: 'cancelled', isAdmin: true, expected: true },
    { from: 'shipped', to: 'delivered', isAdmin: false, expected: true },
    { from: 'shipped', to: 'cancelled', isAdmin: true, expected: false }, // Cannot cancel after shipped
    { from: 'delivered', to: 'refunded', isAdmin: true, expected: true },
    { from: 'cancelled', to: 'pending', isAdmin: true, expected: false }, // Terminal state
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    const result = orderStatusService.validateTransition(test.from, test.to, test.isAdmin);
    const success = result.valid === test.expected;
    
    if (success) {
      console.log(`✓ ${test.from} → ${test.to} (admin: ${test.isAdmin}): ${result.valid ? 'VALID' : 'INVALID'}`);
      passed++;
    } else {
      console.log(`✗ ${test.from} → ${test.to} (admin: ${test.isAdmin}): Expected ${test.expected}, got ${result.valid}`);
      console.log(`  Message: ${result.message}`);
      failed++;
    }
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  return failed === 0;
}

/**
 * Test 2: Get Valid Next Statuses
 */
async function testValidNextStatuses() {
  console.log('\n--- Test 2: Valid Next Statuses ---');
  
  const statuses = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'];
  
  for (const status of statuses) {
    const customerStatuses = orderStatusService.getValidNextStatuses(status, false);
    const adminStatuses = orderStatusService.getValidNextStatuses(status, true);
    
    console.log(`\n${status}:`);
    console.log(`  Customer can transition to: ${customerStatuses.join(', ') || 'none'}`);
    console.log(`  Admin can transition to: ${adminStatuses.join(', ') || 'none'}`);
  }

  return true;
}

/**
 * Test 3: Update Order Status
 */
async function testUpdateOrderStatus() {
  console.log('\n--- Test 3: Update Order Status ---');
  
  try {
    // Refresh test order
    testOrder = await Order.findById(testOrder._id);
    console.log('Current status:', testOrder.status);

    // Test valid transition: pending → confirmed
    console.log('\nTransition 1: pending → confirmed');
    let result = await orderStatusService.updateOrderStatus(
      testOrder._id.toString(),
      'confirmed',
      {
        userId: testUser._id.toString(),
        isAdmin: false,
        reason: 'payment_verified',
        notes: 'Payment confirmed via test'
      }
    );

    if (result.success) {
      console.log('✓ Successfully transitioned to confirmed');
      console.log('  Fulfillment metrics:', result.order.fulfillmentMetrics);
    } else {
      console.log('✗ Failed:', result.message);
      return false;
    }

    // Test valid transition: confirmed → processing
    console.log('\nTransition 2: confirmed → processing');
    result = await orderStatusService.updateOrderStatus(
      testOrder._id.toString(),
      'processing',
      {
        userId: testUser._id.toString(),
        isAdmin: true,
        reason: 'warehouse_assigned',
        notes: 'Order assigned to warehouse'
      }
    );

    if (result.success) {
      console.log('✓ Successfully transitioned to processing');
      console.log('  Fulfillment metrics:', result.order.fulfillmentMetrics);
    } else {
      console.log('✗ Failed:', result.message);
      return false;
    }

    // Test invalid transition: processing → pending
    console.log('\nTransition 3: processing → pending (should fail)');
    result = await orderStatusService.updateOrderStatus(
      testOrder._id.toString(),
      'pending',
      {
        userId: testUser._id.toString(),
        isAdmin: false
      }
    );

    if (!result.success) {
      console.log('✓ Correctly rejected invalid transition');
      console.log('  Message:', result.message);
    } else {
      console.log('✗ Should have rejected this transition');
      return false;
    }

    return true;
  } catch (error) {
    console.error('✗ Test error:', error.message);
    return false;
  }
}

/**
 * Test 4: Status History Tracking
 */
async function testStatusHistory() {
  console.log('\n--- Test 4: Status History ---');
  
  try {
    const result = await orderStatusService.getStatusHistory(testOrder._id.toString());
    
    if (result.success) {
      console.log('✓ Retrieved status history');
      console.log('  Current status:', result.currentStatus);
      console.log('  History entries:', result.history.length);
      
      result.history.forEach((entry, index) => {
        console.log(`\n  Entry ${index + 1}:`);
        console.log(`    Status: ${entry.status}`);
        console.log(`    Timestamp: ${entry.timestamp}`);
        console.log(`    Reason: ${entry.reason || 'N/A'}`);
        console.log(`    Notes: ${entry.notes || 'N/A'}`);
      });
      
      return true;
    } else {
      console.log('✗ Failed to retrieve history:', result.message);
      return false;
    }
  } catch (error) {
    console.error('✗ Test error:', error.message);
    return false;
  }
}

/**
 * Test 5: Fulfillment Metrics Calculation
 */
async function testFulfillmentMetrics() {
  console.log('\n--- Test 5: Fulfillment Metrics ---');
  
  try {
    // Complete the order workflow
    testOrder = await Order.findById(testOrder._id);
    
    // Transition to shipped
    let result = await orderStatusService.updateOrderStatus(
      testOrder._id.toString(),
      'shipped',
      {
        userId: testUser._id.toString(),
        isAdmin: true,
        reason: 'handed_to_carrier',
        notes: 'Package handed to carrier'
      }
    );

    if (!result.success) {
      console.log('✗ Failed to transition to shipped:', result.message);
      return false;
    }

    console.log('✓ Transitioned to shipped');
    console.log('  Time to ship:', result.order.fulfillmentMetrics.timeToShip, 'hours');

    // Transition to delivered
    result = await orderStatusService.updateOrderStatus(
      testOrder._id.toString(),
      'delivered',
      {
        userId: testUser._id.toString(),
        isAdmin: true,
        reason: 'customer_received',
        notes: 'Package delivered successfully'
      }
    );

    if (!result.success) {
      console.log('✗ Failed to transition to delivered:', result.message);
      return false;
    }

    console.log('✓ Transitioned to delivered');
    console.log('  Time to deliver:', result.order.fulfillmentMetrics.timeToDeliver, 'hours');
    console.log('  Total fulfillment metrics:', result.order.fulfillmentMetrics);

    return true;
  } catch (error) {
    console.error('✗ Test error:', error.message);
    return false;
  }
}

/**
 * Test 6: Status Statistics
 */
async function testStatusStatistics() {
  console.log('\n--- Test 6: Status Statistics ---');
  
  try {
    const result = await orderStatusService.getStatusStatistics();
    
    if (result.success) {
      console.log('✓ Retrieved status statistics');
      result.statistics.forEach(stat => {
        console.log(`  ${stat.status}: ${stat.count} orders, ₹${stat.totalValue.toFixed(2)} total value`);
      });
      return true;
    } else {
      console.log('✗ Failed to retrieve statistics:', result.message);
      return false;
    }
  } catch (error) {
    console.error('✗ Test error:', error.message);
    return false;
  }
}

/**
 * Cleanup test data
 */
async function cleanup() {
  try {
    console.log('\n--- Cleanup ---');
    
    if (testOrder) {
      await Order.findByIdAndDelete(testOrder._id);
      console.log('✓ Deleted test order');
    }
    
    // Note: We don't delete user and product as they might be shared
    
    await mongoose.connection.close();
    console.log('✓ Database connection closed');
  } catch (error) {
    console.error('✗ Cleanup error:', error.message);
  }
}

/**
 * Run all tests
 */
async function runTests() {
  console.log('╔════════════════════════════════════════════════╗');
  console.log('║   Order Status Transition Testing Suite       ║');
  console.log('╚════════════════════════════════════════════════╝');

  try {
    await connectDB();
    await createTestData();

    const results = [];
    
    results.push({ name: 'Status Transition Validation', passed: await testStatusTransitions() });
    results.push({ name: 'Valid Next Statuses', passed: await testValidNextStatuses() });
    results.push({ name: 'Update Order Status', passed: await testUpdateOrderStatus() });
    results.push({ name: 'Status History Tracking', passed: await testStatusHistory() });
    results.push({ name: 'Fulfillment Metrics', passed: await testFulfillmentMetrics() });
    results.push({ name: 'Status Statistics', passed: await testStatusStatistics() });

    // Print summary
    console.log('\n╔════════════════════════════════════════════════╗');
    console.log('║              Test Summary                      ║');
    console.log('╚════════════════════════════════════════════════╝');
    
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    
    results.forEach(result => {
      const status = result.passed ? '✓ PASS' : '✗ FAIL';
      console.log(`${status}: ${result.name}`);
    });
    
    console.log(`\nTotal: ${passed} passed, ${failed} failed`);
    
    if (failed === 0) {
      console.log('\n🎉 All tests passed!');
    } else {
      console.log('\n⚠️  Some tests failed. Please review the output above.');
    }

  } catch (error) {
    console.error('\n✗ Test suite error:', error);
  } finally {
    await cleanup();
  }
}

// Run tests
runTests();
