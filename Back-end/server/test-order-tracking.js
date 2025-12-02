/**
 * Test Order Tracking System
 * Tests tracking number generation, events, and carrier integration
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import orderTrackingService, { CARRIERS, TRACKING_STATUS } from './services/orderTrackingService.js';
import trackingNotificationService from './services/trackingNotificationService.js';
import Order from './models/Order.js';
import User from './models/User.js';
import Product from './models/Product.js';
import Category from './models/Category.js';

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
    testUser = await User.findOne({ email: 'tracking-test@example.com' });
    if (!testUser) {
      const bcrypt = await import('bcryptjs');
      const hashedPassword = await bcrypt.default.hash('password123', 10);
      testUser = await User.create({
        name: 'Tracking Test User',
        email: 'tracking-test@example.com',
        passwordHash: hashedPassword,
        role: 'customer'
      });
    }
    console.log('✓ Test user created/found:', testUser.email);

    // Create test category
    let testCategory = await Category.findOne({ name: 'Test Category' });
    if (!testCategory) {
      testCategory = await Category.create({
        name: 'Test Category',
        slug: 'test-category',
        description: 'Test category',
        isActive: true
      });
    }

    // Create test product
    testProduct = await Product.findOne({ name: 'Test Product' });
    if (!testProduct) {
      testProduct = await Product.create({
        name: 'Test Product',
        description: 'Test product for tracking testing',
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
        phone: '9876543210',
        addressLine1: '123 Test St',
        city: 'Mumbai',
        state: 'Maharashtra',
        postalCode: '400001'
      },
      subtotal: 2000,
      totalAmount: 2000,
      status: 'confirmed'
    });
    console.log('✓ Test order created:', testOrder._id);

  } catch (error) {
    console.error('✗ Error creating test data:', error.message);
    throw error;
  }
}

/**
 * Test 1: Tracking Number Generation
 */
async function testTrackingNumberGeneration() {
  console.log('\n--- Test 1: Tracking Number Generation ---');
  
  const carriers = ['FEDEX', 'UPS', 'DHL', 'DELHIVERY', 'INDIA_POST', 'BLUE_DART'];
  let passed = 0;
  let failed = 0;

  for (const carrierCode of carriers) {
    try {
      const trackingNumber = orderTrackingService.generateTrackingNumber(carrierCode);
      const isValid = orderTrackingService.validateTrackingNumber(trackingNumber, carrierCode);
      
      if (isValid) {
        console.log(`✓ ${carrierCode}: ${trackingNumber} (Valid)`);
        passed++;
      } else {
        console.log(`✗ ${carrierCode}: ${trackingNumber} (Invalid format)`);
        failed++;
      }
    } catch (error) {
      console.log(`✗ ${carrierCode}: Error - ${error.message}`);
      failed++;
    }
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  return failed === 0;
}

/**
 * Test 2: Add Tracking Information
 */
async function testAddTrackingInfo() {
  console.log('\n--- Test 2: Add Tracking Information ---');
  
  try {
    const trackingNumber = orderTrackingService.generateTrackingNumber('DELHIVERY');
    
    const result = await orderTrackingService.addTrackingInfo(testOrder._id.toString(), {
      trackingNumber,
      carrierCode: 'DELHIVERY',
      notes: 'Package ready for pickup'
    });

    if (result.success) {
      console.log('✓ Tracking information added successfully');
      console.log('  Tracking Number:', trackingNumber);
      console.log('  Tracking URL:', result.trackingUrl);
      console.log('  Estimated Delivery:', result.estimatedDelivery);
      
      // Verify carrier info
      if (result.order.carrier && result.order.carrier.name === 'Delhivery') {
        console.log('✓ Carrier information set correctly');
      }
      
      // Verify initial tracking event
      if (result.order.trackingEvents && result.order.trackingEvents.length > 0) {
        console.log('✓ Initial tracking event created');
      }
      
      return true;
    } else {
      console.log('✗ Failed to add tracking:', result.message);
      return false;
    }
  } catch (error) {
    console.log('✗ Test error:', error.message);
    return false;
  }
}

/**
 * Test 3: Add Tracking Events
 */
async function testAddTrackingEvents() {
  console.log('\n--- Test 3: Add Tracking Events ---');
  
  const events = [
    {
      status: TRACKING_STATUS.PICKED_UP,
      location: 'Warehouse Mumbai',
      description: 'Package picked up from warehouse'
    },
    {
      status: TRACKING_STATUS.IN_TRANSIT,
      location: 'Hub Delhi',
      description: 'Package arrived at sorting facility'
    },
    {
      status: TRACKING_STATUS.OUT_FOR_DELIVERY,
      location: 'Local Delivery Center',
      description: 'Out for delivery'
    }
  ];

  let passed = 0;
  let failed = 0;

  for (const eventData of events) {
    const result = await orderTrackingService.addTrackingEvent(
      testOrder._id.toString(),
      eventData
    );

    if (result.success) {
      console.log(`✓ Event added: ${eventData.status} at ${eventData.location}`);
      passed++;
    } else {
      console.log(`✗ Failed to add event: ${result.message}`);
      failed++;
    }
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  return failed === 0;
}

/**
 * Test 4: Get Tracking History
 */
async function testGetTrackingHistory() {
  console.log('\n--- Test 4: Get Tracking History ---');
  
  try {
    const result = await orderTrackingService.getTrackingHistory(testOrder._id.toString());
    
    if (result.success) {
      console.log('✓ Retrieved tracking history');
      console.log('  Tracking Number:', result.trackingNumber);
      console.log('  Carrier:', result.carrier.name);
      console.log('  Current Status:', result.currentStatus);
      console.log('  Events Count:', result.events.length);
      
      console.log('\n  Recent Events:');
      result.events.slice(0, 3).forEach((event, index) => {
        console.log(`    ${index + 1}. ${event.status} - ${event.location}`);
        console.log(`       ${new Date(event.timestamp).toLocaleString()}`);
      });
      
      return true;
    } else {
      console.log('✗ Failed to get tracking history:', result.message);
      return false;
    }
  } catch (error) {
    console.log('✗ Test error:', error.message);
    return false;
  }
}

/**
 * Test 5: Public Tracking Lookup
 */
async function testPublicTrackingLookup() {
  console.log('\n--- Test 5: Public Tracking Lookup ---');
  
  try {
    // Refresh test order to get tracking number
    testOrder = await Order.findById(testOrder._id);
    
    const result = await orderTrackingService.trackByNumber(testOrder.trackingNumber);
    
    if (result.success) {
      console.log('✓ Public tracking lookup successful');
      console.log('  Tracking Number:', result.trackingNumber);
      console.log('  Status:', result.currentStatus);
      console.log('  Destination:', `${result.destination.city}, ${result.destination.state}`);
      console.log('  Events:', result.events.length);
      
      // Verify privacy - shouldn't include full address
      if (!result.destination.addressLine1) {
        console.log('✓ Privacy maintained (full address not exposed)');
      }
      
      return true;
    } else {
      console.log('✗ Failed:', result.message);
      return false;
    }
  } catch (error) {
    console.log('✗ Test error:', error.message);
    return false;
  }
}

/**
 * Test 6: Auto-Update Order Status on Delivery
 */
async function testAutoUpdateOnDelivery() {
  console.log('\n--- Test 6: Auto-Update Order Status on Delivery ---');
  
  try {
    // First update order to shipped
    testOrder = await Order.findById(testOrder._id);
    testOrder.status = 'shipped';
    if (!testOrder.fulfillmentMetrics) {
      testOrder.fulfillmentMetrics = {};
    }
    testOrder.fulfillmentMetrics.shippedAt = new Date();
    await testOrder.save();
    
    console.log('  Current order status:', testOrder.status);
    
    // Add delivered event
    const result = await orderTrackingService.addTrackingEvent(
      testOrder._id.toString(),
      {
        status: TRACKING_STATUS.DELIVERED,
        location: 'Customer Address',
        description: 'Package delivered successfully'
      }
    );

    if (result.success) {
      const updatedOrder = result.order;
      
      if (updatedOrder.status === 'delivered') {
        console.log('✓ Order status automatically updated to delivered');
      }
      
      if (updatedOrder.deliveredAt) {
        console.log('✓ Delivery timestamp set');
      }
      
      if (updatedOrder.fulfillmentMetrics && updatedOrder.fulfillmentMetrics.timeToDeliver !== undefined) {
        console.log(`✓ Time to deliver calculated: ${updatedOrder.fulfillmentMetrics.timeToDeliver} hours`);
      }
      
      return true;
    } else {
      console.log('✗ Failed:', result.message);
      return false;
    }
  } catch (error) {
    console.log('✗ Test error:', error.message);
    return false;
  }
}

/**
 * Test 7: Tracking Simulation
 */
async function testTrackingSimulation() {
  console.log('\n--- Test 7: Tracking Simulation ---');
  
  try {
    // Create new test order for simulation
    const simOrder = await Order.create({
      user: testUser._id,
      items: [{
        product: testProduct._id,
        quantity: 1,
        price: testProduct.price,
        name: testProduct.name
      }],
      shippingAddress: testOrder.shippingAddress,
      subtotal: 1000,
      totalAmount: 1000,
      status: 'confirmed'
    });

    // Add tracking
    const trackingNumber = orderTrackingService.generateTrackingNumber('FEDEX');
    await orderTrackingService.addTrackingInfo(simOrder._id.toString(), {
      trackingNumber,
      carrierCode: 'FEDEX'
    });

    // Simulate normal delivery
    const result = await orderTrackingService.simulateTracking(
      simOrder._id.toString(),
      'normal_delivery'
    );

    if (result.success) {
      console.log(`✓ Simulation completed: ${result.eventsAdded} events added`);
      
      // Verify events were added
      const history = await orderTrackingService.getTrackingHistory(simOrder._id.toString());
      console.log(`  Total events in history: ${history.events.length}`);
      
      // Cleanup
      await Order.findByIdAndDelete(simOrder._id);
      
      return true;
    } else {
      console.log('✗ Failed:', result.message);
      return false;
    }
  } catch (error) {
    console.log('✗ Test error:', error.message);
    return false;
  }
}

/**
 * Test 8: Supported Carriers
 */
async function testSupportedCarriers() {
  console.log('\n--- Test 8: Supported Carriers ---');
  
  try {
    const carriers = orderTrackingService.getSupportedCarriers();
    
    console.log(`✓ Found ${carriers.length} supported carriers:`);
    carriers.forEach(carrier => {
      console.log(`  - ${carrier.name} (${carrier.code}): ${carrier.estimatedDeliveryDays} days`);
    });
    
    return carriers.length > 0;
  } catch (error) {
    console.log('✗ Test error:', error.message);
    return false;
  }
}

/**
 * Test 9: Tracking Statistics
 */
async function testTrackingStatistics() {
  console.log('\n--- Test 9: Tracking Statistics ---');
  
  try {
    const result = await orderTrackingService.getTrackingStatistics();
    
    if (result.success) {
      console.log('✓ Retrieved tracking statistics');
      
      if (result.statistics.length > 0) {
        console.log('\nStatistics by Carrier:');
        result.statistics.forEach(stat => {
          console.log(`  ${stat.carrierName}:`);
          console.log(`    Total Orders: ${stat.totalOrders}`);
          console.log(`    Delivered: ${stat.delivered}`);
          console.log(`    In Transit: ${stat.inTransit}`);
          console.log(`    Delivery Rate: ${stat.deliveryRate?.toFixed(2)}%`);
          console.log(`    Avg Delivery Time: ${stat.avgDeliveryTime || 'N/A'} hours`);
        });
      } else {
        console.log('  No statistics available yet');
      }
      
      return true;
    } else {
      console.log('✗ Failed:', result.message);
      return false;
    }
  } catch (error) {
    console.log('✗ Test error:', error.message);
    return false;
  }
}

/**
 * Test 10: Tracking Notifications
 */
async function testTrackingNotifications() {
  console.log('\n--- Test 10: Tracking Notifications ---');
  
  try {
    // Test notification on event
    const event = {
      status: 'out_for_delivery',
      location: 'Local Delivery Center',
      description: 'Out for delivery',
      timestamp: new Date()
    };

    const result = await trackingNotificationService.notifyTrackingEvent(
      testOrder._id.toString(),
      event
    );

    if (result.success) {
      console.log('✓ Notification sent successfully');
      console.log(`  Channels used: ${result.notifications.length}`);
      
      result.notifications.forEach(notif => {
        if (notif.success) {
          console.log(`  ✓ ${notif.type} notification sent`);
        }
      });
      
      return true;
    } else {
      console.log('✗ Failed:', result.message);
      return false;
    }
  } catch (error) {
    console.log('✗ Test error:', error.message);
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
  console.log('║   Order Tracking System Testing Suite         ║');
  console.log('╚════════════════════════════════════════════════╝');

  try {
    await connectDB();
    await createTestData();

    const results = [];
    
    results.push({ name: 'Tracking Number Generation', passed: await testTrackingNumberGeneration() });
    results.push({ name: 'Add Tracking Information', passed: await testAddTrackingInfo() });
    results.push({ name: 'Add Tracking Events', passed: await testAddTrackingEvents() });
    results.push({ name: 'Get Tracking History', passed: await testGetTrackingHistory() });
    results.push({ name: 'Public Tracking Lookup', passed: await testPublicTrackingLookup() });
    results.push({ name: 'Auto-Update on Delivery', passed: await testAutoUpdateOnDelivery() });
    results.push({ name: 'Tracking Simulation', passed: await testTrackingSimulation() });
    results.push({ name: 'Supported Carriers', passed: await testSupportedCarriers() });
    results.push({ name: 'Tracking Statistics', passed: await testTrackingStatistics() });
    results.push({ name: 'Tracking Notifications', passed: await testTrackingNotifications() });

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
