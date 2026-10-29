/**
 * Diagnostic: send the three SHAPES of mail the store sends, through one chosen
 * provider, to one inbox — to prove a provider before switching EMAIL_PROVIDER.
 *
 *   1. Password reset  — plain transactional, default sender (noreply@)
 *   2. Invoice         — the order-confirmation shape: a PDF attachment
 *   3. Support reply   — Reply-To + Message-ID / In-Reply-To / Auto-Submitted
 *                        headers, from the welcome sender (info@)
 *
 * Usage (prod variables injected by Railway, run from Back-end/server):
 *   railway run --service EcommerceAutobacs --environment production -- \
 *     node scripts/send-test-email.js --provider zeptomail you@example.com
 *
 * --provider overrides EMAIL_PROVIDER for THIS process only; the live service is
 * untouched. Nothing is written to the database, no customer is mailed, and no
 * credential is printed. Exit code 0 only when all three were accepted.
 *
 * Afterwards, in the received mail: "Show original" (Gmail) must say
 * SPF: PASS and DKIM: PASS for autobacsindia.com, and it must be in the inbox.
 */
import 'dotenv/config';
import crypto from 'crypto';
import PDFDocument from 'pdfkit';

const args = process.argv.slice(2);
const providerFlag = args.indexOf('--provider');
if (providerFlag !== -1) {
  process.env.EMAIL_PROVIDER = args[providerFlag + 1];
  args.splice(providerFlag, 2);
}
const to = args[0] || process.env.TEST_EMAIL_RECIPIENT;

if (!to) {
  console.error('Usage: node scripts/send-test-email.js [--provider zeptomail|postmark] <recipient@email>');
  process.exit(2);
}

// The redirect guard would reroute these; say so rather than surprise anyone.
if (process.env.EMAIL_REDIRECT_TO) {
  console.warn(`[test] EMAIL_REDIRECT_TO is set — mail goes there, not to ${to}`);
}

// Import after the provider override so the handler logs the intended selection.
const { default: emailHandler } = await import('../services/emailHandler.js');
const { passwordResetEmail } = await import('../utils/emailTemplates.js');

const status = emailHandler.getStatus();
console.log('[test] provider:', status.provider, '| configured:', status.configuredProviders.join(', ') || 'none');
console.log('[test] sender:', `${status.fromName} <${status.fromEmail}>`);

if (!status.enabled || !status.configuredProviders.includes(status.provider)) {
  console.error(`\n[test] "${status.provider}" is not configured in this environment — nothing sent.`);
  process.exit(1);
}

const tinyPdf = () =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A6' });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.fontSize(14).text('Autobacs India — email delivery test');
    doc.fontSize(10).text(`Sent ${new Date().toISOString()} via ${status.provider}`);
    doc.end();
  });

const stamp = `${status.provider} ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
const frontendUrl = (process.env.FRONTEND_URL || 'https://autobacsindia.com').replace(/\/$/, '');

const reset = passwordResetEmail({
  name: 'Test',
  // Throwaway token: not tied to any account, resets nothing.
  resetUrl: `${frontendUrl}/reset-password?token=${crypto.randomBytes(32).toString('hex')}`,
  expiresInMinutes: 15,
});

const messageId = `<delivery-test.${crypto.randomUUID()}@autobacsindia.com>`;

const sends = [
  ['password reset', { to, subject: `[Test 1/3 · ${stamp}] ${reset.subject}`, text: reset.text, html: reset.html }],
  ['invoice + PDF', {
    to,
    subject: `[Test 2/3 · ${stamp}] Invoice attachment`,
    text: 'The attached PDF should open. This is how order-confirmation invoices arrive.',
    attachments: [{ Name: 'delivery-test.pdf', Content: (await tinyPdf()).toString('base64'), ContentType: 'application/pdf' }],
  }],
  ['support reply', {
    to,
    subject: `[Test 3/3 · ${stamp}] Support reply headers`,
    text: 'Reply-To should be support@. Sent from the welcome sender.',
    fromEmail: process.env.EMAIL_WELCOME_FROM_ADDRESS || process.env.POSTMARK_WELCOME_FROM_EMAIL || undefined,
    fromName: process.env.EMAIL_WELCOME_FROM_NAME || process.env.POSTMARK_WELCOME_FROM_NAME || undefined,
    replyTo: process.env.SUPPORT_EMAIL || 'support@autobacsindia.com',
    headers: {
      'Message-ID': messageId,
      'In-Reply-To': '<delivery-test.parent@autobacsindia.com>',
      'Auto-Submitted': 'auto-generated',
    },
  }],
];

let failures = 0;
for (const [label, message] of sends) {
  const result = await emailHandler.sendEmail(message);
  if (result.success) {
    console.log(`[test] ✓ ${label}: accepted (provider id ${result.messageId ?? 'n/a'})`);
  } else {
    failures += 1;
    console.error(`[test] ✗ ${label}: ${result.error} (retryable: ${result.retryable})`);
  }
}

console.log(`\n[test] Message-ID requested for test 3: ${messageId}`);
console.log('[test] In the inbox, open test 3 → "Show original" and compare its Message-ID.');
process.exit(failures === 0 ? 0 : 1);
