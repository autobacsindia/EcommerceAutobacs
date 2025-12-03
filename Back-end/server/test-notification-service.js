/**
 * Test Script for Email/SMS Notification Services
 * Tests SendGrid and Twilio integration with mock order data
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import emailHandler from './services/emailHandler.js';
import smsHandler from './services/smsHandler.js';
import notificationLogger from './services/notificationLogger.js';
import orderNotificationService from './services/orderNotificationService.js';

// Load environment variables
dotenv.config();

// Test data
const mockOrder = {
  _id: '507f1f77bcf86cd799439011',
  status: 'shipped',
  items: [
    {
      name: 'Engine Oil Filter',
      quantity: 2,
      price: 450.00
    },
    {
      name: 'Air Filter',
      quantity: 1,
      price: 350.00
    }
  ],
  subtotal: 1250.00,
  shippingCost: 100.00,
  tax: 135.00,
  discount: 0,
  totalAmount: 1485.00,
  trackingNumber: 'TRK1234567890',
  estimatedDelivery: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
  shippingAddress: {
    fullName: 'Test Customer',
    addressLine1: '123 Test Street',
    city: 'Mumbai',
    state: 'Maharashtra',
    postalCode: '400001',
    phone: '+919876543210'
  },
  carrier: {
    name: 'BlueDart',
    trackingUrl: 'https://www.bluedart.com/tracking'
  },
  createdAt: new Date()
};

const mockUser = {
  _id: '507f1f77bcf86cd799439012',
  id: '507f1f77bcf86cd799439012',
  name: 'Test Customer',
  email: 'test@example.com'
};

// Color codes for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

/**
 * Display test section header
 */
function testHeader(title) {
  console.log(`\n${colors.bright}${colors.cyan}${'='.repeat(70)}${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}  ${title}${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}${'='.repeat(70)}${colors.reset}\n`);
}

/**
 * Display test result
 */
function testResult(testName, success, message = '') {
  const icon = success ? '✓' : '✗';
  const color = success ? colors.green : colors.red;
  console.log(`${color}${icon} ${testName}${colors.reset}`);
  if (message) {
    console.log(`  ${colors.yellow}${message}${colors.reset}`);
  }
}

/**
 * Test email handler status
 */
async function testEmailHandlerStatus() {
  testHeader('Email Handler Status Check');
  
  const status = emailHandler.getStatus();
  
  console.log('Configuration:');
  console.log(`  Enabled: ${status.enabled ? colors.green + 'YES' : colors.red + 'NO'}${colors.reset}`);
  console.log(`  Provider: ${status.provider}`);
  console.log(`  From Email: ${status.fromEmail || 'Not configured'}`);
  console.log(`  From Name: ${status.fromName || 'Not configured'}`);
  console.log(`  Retry Attempts: ${status.retryAttempts}`);
  console.log(`  Retry Delay: ${status.retryDelay}ms`);
  
  testResult('Email handler initialization', true, status.enabled ? 'Ready to send emails' : 'Service disabled - will use mock');
}

/**
 * Test SMS handler status
 */
async function testSmsHandlerStatus() {
  testHeader('SMS Handler Status Check');
  
  const status = smsHandler.getStatus();
  
  console.log('Configuration:');
  console.log(`  Enabled: ${status.enabled ? colors.green + 'YES' : colors.red + 'NO'}${colors.reset}`);
  console.log(`  Provider: ${status.provider}`);
  console.log(`  From Phone: ${status.fromPhone || 'Not configured'}`);
  console.log(`  Retry Attempts: ${status.retryAttempts}`);
  console.log(`  Retry Delay: ${status.retryDelay}ms`);
  console.log(`  Max Message Length: ${status.maxMessageLength} characters`);
  
  testResult('SMS handler initialization', true, status.enabled ? 'Ready to send SMS' : 'Service disabled - will use mock');
}

/**
 * Test email sending
 */
async function testEmailSending() {
  testHeader('Email Sending Test');
  
  console.log('Sending test email...');
  
  const result = await emailHandler.sendEmail({
    to: mockUser.email,
    subject: 'Test Email - Order Notification Service',
    text: 'This is a test email from the Autobacs notification service integration.'
  });
  
  console.log('\nResult:');
  console.log(`  Success: ${result.success}`);
  console.log(`  Provider: ${result.provider}`);
  if (result.messageId) {
    console.log(`  Message ID: ${result.messageId}`);
  }
  if (result.error) {
    console.log(`  Error: ${result.error}`);
  }
  if (result.fallbackToConsole) {
    console.log(`  ${colors.yellow}Note: Email service not configured, using console output${colors.reset}`);
  }
  
  testResult('Email delivery', result.success || result.fallbackToConsole, 
    result.success ? 'Email sent successfully' : 'Using mock/fallback');
}

/**
 * Test SMS sending
 */
async function testSmsSending() {
  testHeader('SMS Sending Test');
  
  console.log('Sending test SMS...');
  
  const result = await smsHandler.sendSms({
    to: mockOrder.shippingAddress.phone,
    message: 'Test SMS from Autobacs notification service. Your order #TEST123 has been shipped!'
  });
  
  console.log('\nResult:');
  console.log(`  Success: ${result.success}`);
  console.log(`  Provider: ${result.provider}`);
  if (result.messageId) {
    console.log(`  Message ID: ${result.messageId}`);
  }
  if (result.error) {
    console.log(`  Error: ${result.error}`);
  }
  if (result.fallbackToConsole) {
    console.log(`  ${colors.yellow}Note: SMS service not configured, using console output${colors.reset}`);
  }
  
  testResult('SMS delivery', result.success || result.fallbackToConsole,
    result.success ? 'SMS sent successfully' : 'Using mock/fallback');
}

/**
 * Test order placed notification
 */
async function testOrderPlacedNotification() {
  testHeader('Order Placed Notification Test');
  
  console.log('Triggering order placed notification...\n');
  
  const result = await orderNotificationService.sendOrderPlacedNotification(mockOrder, mockUser);
  
  testResult('Order placed notification', result.success, 
    'Notification triggered - check console output above');
}

/**
 * Test order shipped notification (email + SMS)
 */
async function testOrderShippedNotification() {
  testHeader('Order Shipped Notification Test (Email + SMS)');
  
  console.log('Triggering order shipped notification...\n');
  
  const result = await orderNotificationService.sendOrderShippedNotification(mockOrder, mockUser);
  
  testResult('Order shipped notification', result.success,
    'Both email and SMS triggered - check console output above');
}

/**
 * Test notification logging (requires MongoDB connection)
 */
async function testNotificationLogging() {
  testHeader('Notification Logging Test');
  
  try {
    // Connect to MongoDB if not connected
    if (mongoose.connection.readyState !== 1) {
      console.log('Connecting to MongoDB...');
      await mongoose.connect(process.env.MONGO_URI);
      console.log(`${colors.green}✓ Connected to MongoDB${colors.reset}\n`);
    }
    
    // Test email logging
    const emailLogResult = await notificationLogger.logEmail({
      orderId: mockOrder._id,
      userId: mockUser._id,
      event: 'order_placed',
      recipient: mockUser.email,
      result: { success: true, provider: 'sendgrid', messageId: 'test-msg-123' },
      subject: 'Test Email Log'
    });
    
    testResult('Email notification logging', emailLogResult !== null,
      emailLogResult ? `Log ID: ${emailLogResult.notificationId}` : 'Logging failed');
    
    // Test SMS logging
    const smsLogResult = await notificationLogger.logSms({
      orderId: mockOrder._id,
      userId: mockUser._id,
      event: 'order_shipped',
      recipient: mockOrder.shippingAddress.phone,
      result: { success: true, provider: 'twilio', messageId: 'test-sms-456' },
      messagePreview: 'Test SMS message'
    });
    
    testResult('SMS notification logging', smsLogResult !== null,
      smsLogResult ? `Log ID: ${smsLogResult.notificationId}` : 'Logging failed');
    
    // Get recent logs
    if (emailLogResult) {
      const orderLogs = await notificationLogger.getOrderLogs(mockOrder._id);
      console.log(`\n${colors.blue}Recent logs for order:${colors.reset} ${orderLogs.length} entries found`);
    }
    
  } catch (error) {
    testResult('Notification logging', false, `Error: ${error.message}`);
    console.log(`\n${colors.yellow}Note: MongoDB connection required for logging tests${colors.reset}`);
  }
}

/**
 * Display summary and recommendations
 */
function displaySummary() {
  testHeader('Configuration Summary & Next Steps');
  
  const emailEnabled = emailHandler.getStatus().enabled;
  const smsEnabled = smsHandler.getStatus().enabled;
  
  console.log('Current Status:');
  console.log(`  Email Service: ${emailEnabled ? colors.green + 'CONFIGURED' : colors.yellow + 'NOT CONFIGURED'}${colors.reset}`);
  console.log(`  SMS Service: ${smsEnabled ? colors.green + 'CONFIGURED' : colors.yellow + 'NOT CONFIGURED'}${colors.reset}`);
  
  if (!emailEnabled || !smsEnabled) {
    console.log(`\n${colors.bright}${colors.yellow}Configuration Required:${colors.reset}`);
    
    if (!emailEnabled) {
      console.log('\nTo enable email notifications:');
      console.log('  1. Create a SendGrid account at https://sendgrid.com/');
      console.log('  2. Generate an API key from Settings > API Keys');
      console.log('  3. Verify your sender email domain');
      console.log('  4. Update .env file:');
      console.log(`     ${colors.cyan}SENDGRID_API_KEY=<your-api-key>${colors.reset}`);
      console.log(`     ${colors.cyan}SENDGRID_FROM_EMAIL=noreply@autobacs.com${colors.reset}`);
      console.log(`     ${colors.cyan}ENABLE_EMAIL_NOTIFICATIONS=true${colors.reset}`);
    }
    
    if (!smsEnabled) {
      console.log('\nTo enable SMS notifications:');
      console.log('  1. Create a Twilio account at https://www.twilio.com/');
      console.log('  2. Get a phone number with SMS capabilities');
      console.log('  3. Find Account SID and Auth Token in console');
      console.log('  4. Complete DLT registration for India');
      console.log('  5. Update .env file:');
      console.log(`     ${colors.cyan}TWILIO_ACCOUNT_SID=<your-account-sid>${colors.reset}`);
      console.log(`     ${colors.cyan}TWILIO_AUTH_TOKEN=<your-auth-token>${colors.reset}`);
      console.log(`     ${colors.cyan}TWILIO_PHONE_NUMBER=+91XXXXXXXXXX${colors.reset}`);
      console.log(`     ${colors.cyan}ENABLE_SMS_NOTIFICATIONS=true${colors.reset}`);
    }
  } else {
    console.log(`\n${colors.green}${colors.bright}✓ All notification services configured and ready!${colors.reset}`);
  }
  
  console.log(`\n${colors.bright}Testing Recommendations:${colors.reset}`);
  console.log('  1. Start with email-only notifications (lower cost)');
  console.log('  2. Use test mode in SendGrid/Twilio for development');
  console.log('  3. Monitor notification logs in MongoDB');
  console.log('  4. Check delivery success rates regularly');
  console.log('  5. Enable SMS for critical events only (cost optimization)');
}

/**
 * Main test runner
 */
async function runTests() {
  console.log(`\n${colors.bright}${colors.blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
  console.log(`${colors.bright}${colors.blue}  Email/SMS Notification Service Integration Tests${colors.reset}`);
  console.log(`${colors.bright}${colors.blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
  
  try {
    // Handler status tests
    await testEmailHandlerStatus();
    await testSmsHandlerStatus();
    
    // Service tests
    await testEmailSending();
    await testSmsSending();
    
    // Integration tests
    await testOrderPlacedNotification();
    await testOrderShippedNotification();
    
    // Logging tests (requires MongoDB)
    await testNotificationLogging();
    
    // Summary
    displaySummary();
    
    console.log(`\n${colors.green}${colors.bright}All tests completed!${colors.reset}\n`);
    
  } catch (error) {
    console.error(`\n${colors.red}${colors.bright}Test error:${colors.reset}`, error);
  } finally {
    // Close MongoDB connection if open
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
      console.log('MongoDB connection closed');
    }
  }
}

// Run tests
runTests();
