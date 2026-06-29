/**
 * Quick Email Test - Verify Postmark Integration
 */

import dotenv from 'dotenv';

// Load environment variables FIRST
dotenv.config();

// Then import the handler
import emailHandler from '../../services/emailHandler.js';

// Reinitialize after env is loaded
emailHandler.initialize();

console.log('\n=== Postmark Configuration Test ===\n');

// Check environment variables
console.log('Environment Variables:');
console.log(`  POSTMARK_SERVER_TOKEN: ${process.env.POSTMARK_SERVER_TOKEN ? '✓ Set (length: ' + process.env.POSTMARK_SERVER_TOKEN.length + ')' : '✗ Not set'}`);
console.log(`  POSTMARK_FROM_EMAIL: ${process.env.POSTMARK_FROM_EMAIL || '✗ Not set'}`);
console.log(`  POSTMARK_FROM_NAME: ${process.env.POSTMARK_FROM_NAME || '(default: Autobacs)'}`);
console.log(`  POSTMARK_MESSAGE_STREAM: ${process.env.POSTMARK_MESSAGE_STREAM || '(default: outbound)'}`);
console.log(`  ENABLE_EMAIL_NOTIFICATIONS: ${process.env.ENABLE_EMAIL_NOTIFICATIONS || '(default: enabled)'}`);

// Check handler status
const status = emailHandler.getStatus();
console.log('\nEmail Handler Status:');
console.log(`  Enabled: ${status.enabled ? '✓ YES' : '✗ NO'}`);
console.log(`  From Email: ${status.fromEmail || 'Not configured'}`);
console.log(`  Message Stream: ${status.messageStream}`);
console.log(`  Provider: ${status.provider}`);

// Resolve a REAL recipient so we verify inbox delivery, not just provider acceptance.
// Priority: CLI arg > TEST_EMAIL_TO env > the verified sender (send to self).
// Never default to example.com — it can't be delivered and harms sender reputation.
const recipient = process.argv[2] || process.env.TEST_EMAIL_TO || status.fromEmail;

// Try sending a test email
if (status.enabled) {
  if (!recipient) {
    console.log('\n⚠ No recipient. Pass one: `npm run test-email -- you@yourdomain.com`');
    process.exit(1);
  }

  console.log(`\n=== Sending Test Email to ${recipient} ===\n`);

  emailHandler.sendEmail({
    to: recipient,
    subject: 'Test Email from Autobacs',
    text: 'This is a test email to verify Postmark integration is working correctly.'
  }).then(result => {
    console.log('Result:', result);
    if (result.success) {
      console.log('\n✓ SUCCESS! Email sent via Postmark');
      console.log(`  Message ID: ${result.messageId}`);
    } else {
      console.log('\n✗ FAILED');
      console.log(`  Error: ${result.error}`);
    }
  }).catch(error => {
    console.error('\n✗ ERROR:', error.message);
  });
} else {
  console.log('\n⚠ Email service is not enabled. Configure POSTMARK_SERVER_TOKEN and POSTMARK_FROM_EMAIL.');
}
