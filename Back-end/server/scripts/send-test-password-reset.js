/**
 * Diagnostic: send a real password-reset email through the configured Postmark
 * sender (noreply@ by default), using the same template the app uses.
 *
 * Usage:
 *   node scripts/send-test-password-reset.js you@example.com
 *
 * Requires these in the environment it runs in (Back-end/server/.env locally, or
 * the Railway shell in prod):
 *   POSTMARK_SERVER_TOKEN, POSTMARK_FROM_EMAIL (=noreply@autobacsindia.com),
 *   ENABLE_EMAIL_NOTIFICATIONS=true, FRONTEND_URL
 *
 * It generates a throwaway reset link (not tied to any account — this only tests
 * deliverability + rendering, it does NOT reset anyone's password).
 */
import 'dotenv/config';
import crypto from 'crypto';
import emailHandler from '../services/emailHandler.js';
import { passwordResetEmail } from '../utils/emailTemplates.js';

const to = process.argv[2] || process.env.TEST_EMAIL_RECIPIENT;

if (!to) {
  console.error('Usage: node scripts/send-test-password-reset.js <recipient@email>');
  process.exit(2);
}

const status = emailHandler.getStatus();
console.log('[test] Email service status:', status);

if (!status.enabled) {
  console.error(
    '\n[test] Email service is DISABLED in this environment.\n' +
    '       Set POSTMARK_SERVER_TOKEN + POSTMARK_FROM_EMAIL + ENABLE_EMAIL_NOTIFICATIONS=true\n' +
    '       (in Back-end/server/.env for a local test, or run this in the Railway shell).\n'
  );
  process.exit(1);
}

const token = crypto.randomBytes(32).toString('hex');
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
const resetUrl = `${frontendUrl}/reset-password?token=${token}`;

const { subject, text, html } = passwordResetEmail({
  name: 'Test User',
  resetUrl,
  expiresInMinutes: 15,
});

console.log(`[test] From: ${status.fromName} <${status.fromEmail}>`);
console.log(`[test] To:   ${to}`);
console.log(`[test] Reset link: ${resetUrl}`);

const result = await emailHandler.sendEmail({ to, subject, text, html });
console.log('[test] Send result:', result);

process.exit(result?.success ? 0 : 1);
