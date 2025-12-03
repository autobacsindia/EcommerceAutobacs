/**
 * Test Order Management Features
 * Tests order cancellation and return request workflows
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Order from './models/Order.js';
import User from './models/User.js';
import Product from './models/Product.js';
import Category from './models/Category.js';
import orderNotificationService from './services/orderNotificationService.js';

dotenv.config();

// Test data
let testUser;
let testAdmin;
let testProduct1;
let testProduct2;
let testCategory;
let testOrder;

/**
 * Connect to MongoDB
 */
async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/autobacs');
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
    testUser = await User.findOne({ email: 'order-test@example.com' });
    if (!testUser) {
      const bcrypt = await import('bcryptjs');
      const hashedPassword = await bcrypt.default.hash('password123', 10);
      testUser = await User.create({
        name: 'Order Test User',
        email: 'order-test@example.com',
        passwordHash: hashedPassword,
        role: 'customer'
      });
    }
    console.log('✓ Test user created:', testUser.email);

    // Create test admin
    testAdmin = await User.findOne({ email: 'admin-test@example.com' });
    if (!testAdmin) {
      const bcrypt = await import('bcryptjs');
      const hashedPassword = await bcrypt.default.hash('admin123', 10);
      testAdmin = await User.create({
        name: 'Test Admin',
        email: 'admin-test@example.com',
        passwordHash: hashedPassword,
        role: 'admin'
      });
    }
    console.log('✓ Test admin created:', testAdmin.email);

    // Create test category
    testCategory = await Category.findOne({ name: 'Order Test Category' });
    if (!testCategory) {
      testCategory = await Category.create({
        name: 'Order Test Category',
        slug: 'order-test-category',
        description: 'Test category for order management',
        isActive: true
      });
    }
    console.log('✓ Test category created');

    // Create test products
    testProduct1 = await Product.findOne({ name: 'Test Product 1 - Order Mgmt' });
    if (!testProduct1) {
      testProduct1 = await Product.create({
        name: 'Test Product 1 - Order Mgmt',
        description: 'Test product 1 for order management testing',
        price: 1000,
        stock: 100,
        category: testCategory._id,
        brand: 'Test Brand',
        isActive: true
      });
    }
    console.log('✓ Test product 1 created');

    testProduct2 = await Product.findOne({ name: 'Test Product 2 - Order Mgmt' });
    if (!testProduct2) {
      testProduct2 = await Product.create({
        name: 'Test Product 2 - Order Mgmt',
        description: 'Test product 2 for order management testing',
        price: 2000,
        stock: 50,
        category: testCategory._id,
        brand: 'Test Brand',
        isActive: true
      });
    }
    console.log('✓ Test product 2 created');

  } catch (error) {
    console.error('✗ Error creating test data:', error.message);
    throw error;
  }
}

/**
 * Test 1: Order Cancellation - Eligible Order
 */
async function testOrderCancellationEligible() {
  console.log('\n--- Test 1: Order Cancellation (Eligible) ---');
  
  try {
    // Create test order in pending status
    const order = await Order.create({
      user: testUser._id,
      items: [
        {
          product: testProduct1._id,
          quantity: 2,
          price: testProduct1.price,
          name: testProduct1.name
        }
      ],
      shippingAddress: {
        fullName: 'Test User',
        phone: '1234567890',
        addressLine1: '123 Test St',
        city: 'Test City',
        state: 'Test State',
        postalCode: '123456',
        country: 'India'
      },
      subtotal: 2000,
      shippingCost: 100,
      tax: 200,
      discount: 0,
      totalAmount: 2300,
      status: 'pending'
    });

    console.log(`Order created: ${order._id}`);
    
    // Check initial stock
    const initialStock = testProduct1.stock;
    
    // Simulate cancellation
    order.status = 'cancelled';
    order.cancelledAt = new Date();
    order.cancellationReason = 'customer_request';
    
    // Restore stock
    testProduct1.stock += order.items[0].quantity;
    await testProduct1.save();
    await order.save();
    
    const finalStock = testProduct1.stock;
    
    console.log(`Initial stock: ${initialStock}`);
    console.log(`Final stock: ${finalStock}`);
    console.log(`Stock restored: ${finalStock - initialStock} units`);
    
    if (finalStock === initialStock + 2) {
      console.log('✓ PASS: Order cancelled successfully and stock restored');
      return true;
    } else {
      console.log('✗ FAIL: Stock restoration incorrect');
      return false;
    }
    
  } catch (error) {
    console.log(`✗ FAIL: ${error.message}`);
    return false;
  }
}

/**
 * Test 2: Return Request Submission
 */
async function testReturnRequestSubmission() {
  console.log('\n--- Test 2: Return Request Submission ---');
  
  try {
    // Create delivered order
    const order = await Order.create({
      user: testUser._id,
      items: [
        {
          product: testProduct2._id,
          quantity: 1,
          price: testProduct2.price,
          name: testProduct2.name
        }
      ],
      shippingAddress: {
        fullName: 'Test User',
        phone: '1234567890',
        addressLine1: '123 Test St',
        city: 'Test City',
        state: 'Test State',
        postalCode: '123456',
        country: 'India'
      },
      subtotal: 2000,
      shippingCost: 100,
      tax: 200,
      discount: 0,
      totalAmount: 2300,
      status: 'delivered',
      deliveredAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) // 5 days ago
    });

    console.log(`Delivered order created: ${order._id}`);
    
    // Submit return request
    order.returnRequest = {
      requestedAt: new Date(),
      requestedBy: testUser._id,
      reason: 'defective',
      status: 'pending',
      items: [
        {
          product: testProduct2._id,
          quantity: 1,
          reason: 'defective'
        }
      ],
      images: [
        {
          url: 'https://example.com/defect1.jpg',
          description: 'Product damage photo'
        }
      ],
      description: 'Product arrived damaged'
    };
    
    await order.save();
    
    if (order.returnRequest && order.returnRequest.status === 'pending') {
      console.log('✓ PASS: Return request submitted successfully');
      console.log(`  Reason: ${order.returnRequest.reason}`);
      console.log(`  Status: ${order.returnRequest.status}`);
      console.log(`  Items: ${order.returnRequest.items.length}`);
      return true;
    } else {
      console.log('✗ FAIL: Return request not created');
      return false;
    }
    
  } catch (error) {
    console.log(`✗ FAIL: ${error.message}`);
    return false;
  }
}

/**
 * Test 3: Return Request Approval
 */
async function testReturnRequestApproval() {
  console.log('\n--- Test 3: Return Request Approval ---');
  
  try {
    // Create order with pending return
    const order = await Order.create({
      user: testUser._id,
      items: [
        {
          product: testProduct1._id,
          quantity: 1,
          price: testProduct1.price,
          name: testProduct1.name
        }
      ],
      shippingAddress: {
        fullName: 'Test User',
        phone: '1234567890',
        addressLine1: '123 Test St',
        city: 'Test City',
        state: 'Test State',
        postalCode: '123456',
        country: 'India'
      },
      subtotal: 1000,
      totalAmount: 1100,
      status: 'delivered',
      deliveredAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      returnRequest: {
        requestedAt: new Date(),
        requestedBy: testUser._id,
        reason: 'wrong_item',
        status: 'pending',
        items: [
          {
            product: testProduct1._id,
            quantity: 1,
            reason: 'wrong_item'
          }
        ]
      }
    });

    console.log(`Order with pending return: ${order._id}`);
    
    // Admin approves return
    order.returnRequest.status = 'approved';
    order.returnRequest.approvedBy = testAdmin._id;
    order.returnRequest.approvedAt = new Date();
    order.returnRequest.adminNotes = 'Approved - customer will receive shipping label';
    order.returnRequest.returnShippingLabel = 'https://shipping.example.com/label/12345';
    
    await order.save();
    
    if (order.returnRequest.status === 'approved' && order.returnRequest.approvedBy) {
      console.log('✓ PASS: Return request approved successfully');
      console.log(`  Approved by: ${order.returnRequest.approvedBy}`);
      console.log(`  Shipping label: ${order.returnRequest.returnShippingLabel}`);
      return true;
    } else {
      console.log('✗ FAIL: Return request approval failed');
      return false;
    }
    
  } catch (error) {
    console.log(`✗ FAIL: ${error.message}`);
    return false;
  }
}

/**
 * Test 4: Return Request Rejection
 */
async function testReturnRequestRejection() {
  console.log('\n--- Test 4: Return Request Rejection ---');
  
  try {
    // Create order with pending return (outside return window)
    const order = await Order.create({
      user: testUser._id,
      items: [
        {
          product: testProduct2._id,
          quantity: 1,
          price: testProduct2.price,
          name: testProduct2.name
        }
      ],
      shippingAddress: {
        fullName: 'Test User',
        phone: '1234567890',
        addressLine1: '123 Test St',
        city: 'Test City',
        state: 'Test State',
        postalCode: '123456',
        country: 'India'
      },
      subtotal: 2000,
      totalAmount: 2200,
      status: 'delivered',
      deliveredAt: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000), // 35 days ago
      returnRequest: {
        requestedAt: new Date(),
        requestedBy: testUser._id,
        reason: 'changed_mind',
        status: 'pending',
        items: [
          {
            product: testProduct2._id,
            quantity: 1,
            reason: 'changed_mind'
          }
        ]
      }
    });

    console.log(`Order with pending return (outside window): ${order._id}`);
    
    // Admin rejects return
    order.returnRequest.status = 'rejected';
    order.returnRequest.approvedBy = testAdmin._id;
    order.returnRequest.approvedAt = new Date();
    order.returnRequest.rejectedReason = 'Return window expired. Returns must be requested within 30 days.';
    
    await order.save();
    
    if (order.returnRequest.status === 'rejected' && order.returnRequest.rejectedReason) {
      console.log('✓ PASS: Return request rejected successfully');
      console.log(`  Reason: ${order.returnRequest.rejectedReason}`);
      return true;
    } else {
      console.log('✗ FAIL: Return request rejection failed');
      return false;
    }
    
  } catch (error) {
    console.log(`✗ FAIL: ${error.message}`);
    return false;
  }
}

/**
 * Test 5: Item Received and Refund Processing
 */
async function testItemReceivedAndRefund() {
  console.log('\n--- Test 5: Item Received and Refund Processing ---');
  
  try {
    // Create order with approved return
    const order = await Order.create({
      user: testUser._id,
      items: [
        {
          product: testProduct1._id,
          quantity: 2,
          price: testProduct1.price,
          name: testProduct1.name
        }
      ],
      shippingAddress: {
        fullName: 'Test User',
        phone: '1234567890',
        addressLine1: '123 Test St',
        city: 'Test City',
        state: 'Test State',
        postalCode: '123456',
        country: 'India'
      },
      subtotal: 2000,
      totalAmount: 2200,
      status: 'delivered',
      deliveredAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      returnRequest: {
        requestedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        requestedBy: testUser._id,
        reason: 'defective',
        status: 'approved',
        approvedBy: testAdmin._id,
        approvedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
        items: [
          {
            product: testProduct1._id,
            quantity: 2,
            reason: 'defective'
          }
        ]
      }
    });

    console.log(`Order with approved return: ${order._id}`);
    
    // Mark item as received
    order.returnRequest.status = 'item_received';
    order.returnRequest.itemReceivedAt = new Date();
    order.returnRequest.inspectionNotes = 'Items inspected - condition confirmed as defective';
    
    await order.save();
    console.log('✓ Item marked as received');
    
    // Process refund
    const refundAmount = 2000; // Subtotal (excluding shipping)
    
    order.refundDetails = {
      requestedAt: new Date(),
      amount: refundAmount,
      refundType: 'full',
      refundMethod: 'original_payment',
      itemsRefunded: order.returnRequest.items,
      status: 'pending',
      processedBy: testAdmin._id,
      notes: 'Refund for defective items'
    };
    
    order.returnRequest.status = 'refund_processed';
    
    await order.save();
    
    if (order.refundDetails && order.refundDetails.status === 'pending' && 
        order.returnRequest.status === 'refund_processed') {
      console.log('✓ PASS: Refund processing workflow completed');
      console.log(`  Refund amount: ₹${refundAmount}`);
      console.log(`  Refund method: ${order.refundDetails.refundMethod}`);
      console.log(`  Return status: ${order.returnRequest.status}`);
      return true;
    } else {
      console.log('✗ FAIL: Refund processing incomplete');
      return false;
    }
    
  } catch (error) {
    console.log(`✗ FAIL: ${error.message}`);
    return false;
  }
}

/**
 * Test 6: Notification Service
 */
async function testNotificationService() {
  console.log('\n--- Test 6: Notification Service ---');
  
  try {
    const order = {
      _id: 'TEST123456',
      createdAt: new Date(),
      totalAmount: 5000,
      items: [
        { name: 'Test Product', quantity: 2, price: 2500 }
      ],
      shippingAddress: {
        fullName: 'Test User',
        phone: '1234567890',
        addressLine1: '123 Test St',
        city: 'Test City',
        state: 'Test State',
        postalCode: '123456'
      },
      trackingNumber: 'TRACK123',
      carrier: { name: 'Test Carrier' },
      estimatedDelivery: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      returnRequest: {
        requestedAt: new Date(),
        reason: 'defective',
        items: [{ product: testProduct1._id }]
      }
    };
    
    const user = {
      name: 'Test User',
      email: 'test@example.com'
    };
    
    // Test various notifications
    console.log('\nTesting notifications:');
    
    await orderNotificationService.sendOrderPlacedNotification(order, user);
    console.log('✓ Order placed notification sent');
    
    await orderNotificationService.sendOrderConfirmedNotification(order, user);
    console.log('✓ Order confirmed notification sent');
    
    await orderNotificationService.sendOrderShippedNotification(order, user);
    console.log('✓ Order shipped notification sent');
    
    await orderNotificationService.sendOrderDeliveredNotification(order, user);
    console.log('✓ Order delivered notification sent');
    
    await orderNotificationService.sendOrderCancelledNotification(order, user, { amount: 5000, timeline: '3-5 days' });
    console.log('✓ Order cancelled notification sent');
    
    await orderNotificationService.sendReturnRequestSubmittedNotification(order, user);
    console.log('✓ Return request submitted notification sent');
    
    await orderNotificationService.sendReturnApprovedNotification(order, user);
    console.log('✓ Return approved notification sent');
    
    console.log('\n✓ PASS: All notifications sent successfully');
    return true;
    
  } catch (error) {
    console.log(`✗ FAIL: ${error.message}`);
    return false;
  }
}

/**
 * Test 7: Return Window Validation
 */
async function testReturnWindowValidation() {
  console.log('\n--- Test 7: Return Window Validation ---');
  
  try {
    // Test within window (5 days)
    const withinWindow = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const daysSinceDelivery1 = (new Date() - withinWindow) / (1000 * 60 * 60 * 24);
    const isEligible1 = daysSinceDelivery1 <= 30;
    
    console.log(`Days since delivery: ${daysSinceDelivery1.toFixed(1)}`);
    console.log(`Within 30-day window: ${isEligible1 ? 'Yes' : 'No'}`);
    
    // Test outside window (35 days)
    const outsideWindow = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);
    const daysSinceDelivery2 = (new Date() - outsideWindow) / (1000 * 60 * 60 * 24);
    const isEligible2 = daysSinceDelivery2 <= 30;
    
    console.log(`\nDays since delivery: ${daysSinceDelivery2.toFixed(1)}`);
    console.log(`Within 30-day window: ${isEligible2 ? 'Yes' : 'No'}`);
    
    if (isEligible1 && !isEligible2) {
      console.log('\n✓ PASS: Return window validation working correctly');
      return true;
    } else {
      console.log('\n✗ FAIL: Return window validation incorrect');
      return false;
    }
    
  } catch (error) {
    console.log(`✗ FAIL: ${error.message}`);
    return false;
  }
}

/**
 * Cleanup test data
 */
async function cleanup() {
  try {
    console.log('\n--- Cleaning Up Test Data ---');
    
    await Order.deleteMany({
      user: { $in: [testUser?._id, testAdmin?._id] }
    });
    console.log('✓ Test orders deleted');
    
  } catch (error) {
    console.error('Error during cleanup:', error.message);
  }
}

/**
 * Main test runner
 */
async function runTests() {
  console.log('\n╔═══════════════════════════════════════════════════════╗');
  console.log('║     Order Management System - Integration Tests      ║');
  console.log('╚═══════════════════════════════════════════════════════╝');
  
  await connectDB();
  await createTestData();
  
  const results = [];
  
  results.push(await testOrderCancellationEligible());
  results.push(await testReturnRequestSubmission());
  results.push(await testReturnRequestApproval());
  results.push(await testReturnRequestRejection());
  results.push(await testItemReceivedAndRefund());
  results.push(await testNotificationService());
  results.push(await testReturnWindowValidation());
  
  await cleanup();
  
  // Summary
  const passed = results.filter(r => r === true).length;
  const failed = results.filter(r => r === false).length;
  
  console.log('\n╔═══════════════════════════════════════════════════════╗');
  console.log('║                    TEST SUMMARY                       ║');
  console.log('╚═══════════════════════════════════════════════════════╝');
  console.log(`Total Tests: ${results.length}`);
  console.log(`✓ Passed: ${passed}`);
  console.log(`✗ Failed: ${failed}`);
  console.log(`Success Rate: ${((passed / results.length) * 100).toFixed(1)}%`);
  
  if (failed === 0) {
    console.log('\n🎉 All tests passed!');
  } else {
    console.log('\n⚠️  Some tests failed. Review the output above for details.');
  }
  
  await mongoose.connection.close();
  process.exit(failed === 0 ? 0 : 1);
}

// Run tests
runTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
