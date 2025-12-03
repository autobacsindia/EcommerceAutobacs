/**
 * Quick Email Test - Verify SendGrid Integration
 */

import dotenv from 'dotenv';

// Load environment variables FIRST
dotenv.config();

// Then import the handler
import emailHandler from './services/emailHandler.js';

// Reinitialize after env is loaded
emailHandler.initialize();

console.log('\n=== SendGrid Configuration Test ===\n');

// Check environment variables
console.log('Environment Variables:');
console.log(`  SENDGRID_API_KEY: ${process.env.SENDGRID_API_KEY ? '✓ Set (length: ' + process.env.SENDGRID_API_KEY.length + ')' : '✗ Not set'}`);
console.log(`  SENDGRID_FROM_EMAIL: ${process.env.SENDGRID_FROM_EMAIL || '✗ Not set'}`);
console.log(`  SENDGRID_FROM_NAME: ${process.env.SENDGRID_FROM_NAME || '✗ Not set'}`);
console.log(`  ENABLE_EMAIL_NOTIFICATIONS: ${process.env.ENABLE_EMAIL_NOTIFICATIONS || 'false'}`);

// Check handler status
const status = emailHandler.getStatus();
console.log('\nEmail Handler Status:');
console.log(`  Enabled: ${status.enabled ? '✓ YES' : '✗ NO'}`);
console.log(`  From Email: ${status.fromEmail || 'Not configured'}`);
console.log(`  Provider: ${status.provider}`);

// Try sending a test email
if (status.enabled) {
  console.log('\n=== Sending Test Email ===\n');
  
  emailHandler.sendEmail({
    to: 'test@example.com',
    subject: 'Test Email from Autobacs',
    text: 'This is a test email to verify SendGrid integration is working correctly.'
  }).then(result => {
    console.log('Result:', result);
    if (result.success) {
      console.log('\n✓ SUCCESS! Email sent via SendGrid');
      console.log(`  Message ID: ${result.messageId}`);
    } else {
      console.log('\n✗ FAILED');
      console.log(`  Error: ${result.error}`);
    }
  }).catch(error => {
    console.error('\n✗ ERROR:', error.message);
  });
} else {
  console.log('\n⚠ Email service is not enabled. Configure credentials in .env file.');
}
