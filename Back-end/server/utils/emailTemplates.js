/**
 * Email Templates for Authentication
 * HTML and text templates for password reset and email verification
 */
import { formatInvoiceNumber } from './invoiceFormat.js';

/**
 * Password Reset Email Template
 * @param {Object} params
 * @param {string} params.name - User's name
 * @param {string} params.resetUrl - Password reset URL with token
 * @param {number} params.expiresInMinutes - Token expiration time in minutes
 * @returns {Object} - { subject, text, html }
 */
export const passwordResetEmail = ({ name, resetUrl, expiresInMinutes = 60 }) => {
  const subject = 'Reset Your Autobacs Password';
  
  const text = `
Hi ${name},

We received a request to reset your password for your Autobacs account.

To reset your password, click the link below:
${resetUrl}

This link will expire in ${expiresInMinutes} minutes for security reasons.

If you didn't request a password reset, please ignore this email and your password will remain unchanged.

For security reasons, this link can only be used once.

If you need assistance, please contact our support team.

Best regards,
Autobacs Team
  `.trim();

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your Password</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      background-color: #f5f5f5;
      margin: 0;
      padding: 0;
    }
    .container {
      max-width: 600px;
      margin: 20px auto;
      background-color: #ffffff;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .header {
      background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
      color: white;
      padding: 30px 20px;
      text-align: center;
    }
    .header h1 {
      margin: 0;
      font-size: 24px;
      font-weight: 600;
    }
    .content {
      padding: 40px 30px;
    }
    .greeting {
      font-size: 18px;
      margin-bottom: 20px;
      color: #1f2937;
    }
    .message {
      color: #4b5563;
      margin-bottom: 30px;
      font-size: 16px;
    }
    .button-container {
      text-align: center;
      margin: 35px 0;
    }
    .button {
      display: inline-block;
      padding: 14px 40px;
      background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
      color: white !important;
      text-decoration: none;
      border-radius: 6px;
      font-weight: 600;
      font-size: 16px;
      box-shadow: 0 4px 6px rgba(37, 99, 235, 0.3);
      transition: transform 0.2s;
    }
    .button:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 8px rgba(37, 99, 235, 0.4);
    }
    .expiry-notice {
      background-color: #fef3c7;
      border-left: 4px solid #f59e0b;
      padding: 15px;
      margin: 25px 0;
      border-radius: 4px;
    }
    .expiry-notice strong {
      color: #92400e;
    }
    .security-notice {
      background-color: #f3f4f6;
      padding: 20px;
      border-radius: 6px;
      margin-top: 30px;
      font-size: 14px;
      color: #6b7280;
    }
    .footer {
      background-color: #f9fafb;
      padding: 25px;
      text-align: center;
      border-top: 1px solid #e5e7eb;
      font-size: 14px;
      color: #6b7280;
    }
    .url-fallback {
      word-break: break-all;
      color: #2563eb;
      font-size: 13px;
      margin-top: 15px;
      padding: 10px;
      background-color: #f3f4f6;
      border-radius: 4px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🔐 Password Reset Request</h1>
    </div>
    
    <div class="content">
      <div class="greeting">Hi ${name},</div>
      
      <div class="message">
        We received a request to reset your password for your Autobacs account. 
        To create a new password, please click the button below:
      </div>
      
      <div class="button-container">
        <a href="${resetUrl}" class="button">Reset Your Password</a>
      </div>
      
      <div class="expiry-notice">
        <strong>⏰ Important:</strong> This link will expire in ${expiresInMinutes} minutes for security reasons and can only be used once.
      </div>
      
      <div class="url-fallback">
        If the button doesn't work, copy and paste this link into your browser:<br>
        ${resetUrl}
      </div>
      
      <div class="security-notice">
        <strong>🔒 Security Notice:</strong> If you didn't request a password reset, you can safely ignore this email. 
        Your password will remain unchanged. Someone may have entered your email address by mistake.
      </div>
    </div>
    
    <div class="footer">
      <p><strong>Autobacs</strong> - Premium Automotive Accessories</p>
      <p>Need help? Contact our support team</p>
      <p style="font-size: 12px; margin-top: 15px;">
        This is an automated email, please do not reply directly to this message.
      </p>
    </div>
  </div>
</body>
</html>
  `.trim();

  return { subject, text, html };
};

/**
 * Email Verification Template
 * @param {Object} params
 * @param {string} params.name - User's name
 * @param {string} params.verifyUrl - Verification URL with token
 * @param {number} params.expiresInHours - Token expiration time in hours
 * @returns {Object} - { subject, text, html }
 */
export const emailVerificationEmail = ({ name, verifyUrl, expiresInHours = 24 }) => {
  const subject = 'Verify Your Autobacs Account';
  
  const text = `
Hi ${name},

Welcome to Autobacs! We're excited to have you on board.

To complete your registration and verify your email address, please click the link below:
${verifyUrl}

This link will expire in ${expiresInHours} hours.

Once verified, you'll have full access to all Autobacs features including:
• Browse thousands of premium automotive products
• Save items to your wishlist
• Track your orders
• Manage multiple delivery addresses
• Get exclusive deals and offers

If you didn't create an account with Autobacs, please ignore this email.

Best regards,
Autobacs Team
  `.trim();

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify Your Email</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      background-color: #f5f5f5;
      margin: 0;
      padding: 0;
    }
    .container {
      max-width: 600px;
      margin: 20px auto;
      background-color: #ffffff;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .header {
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      color: white;
      padding: 30px 20px;
      text-align: center;
    }
    .header h1 {
      margin: 0;
      font-size: 24px;
      font-weight: 600;
    }
    .content {
      padding: 40px 30px;
    }
    .greeting {
      font-size: 18px;
      margin-bottom: 20px;
      color: #1f2937;
    }
    .welcome-message {
      font-size: 16px;
      color: #4b5563;
      margin-bottom: 25px;
    }
    .button-container {
      text-align: center;
      margin: 35px 0;
    }
    .button {
      display: inline-block;
      padding: 14px 40px;
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      color: white !important;
      text-decoration: none;
      border-radius: 6px;
      font-weight: 600;
      font-size: 16px;
      box-shadow: 0 4px 6px rgba(16, 185, 129, 0.3);
      transition: transform 0.2s;
    }
    .button:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 8px rgba(16, 185, 129, 0.4);
    }
    .features {
      background-color: #f0fdf4;
      padding: 25px;
      border-radius: 6px;
      margin: 25px 0;
    }
    .features h3 {
      margin-top: 0;
      color: #065f46;
      font-size: 16px;
    }
    .features ul {
      margin: 15px 0;
      padding-left: 20px;
    }
    .features li {
      color: #047857;
      margin-bottom: 8px;
      font-size: 14px;
    }
    .expiry-notice {
      background-color: #fef3c7;
      border-left: 4px solid #f59e0b;
      padding: 15px;
      margin: 25px 0;
      border-radius: 4px;
      font-size: 14px;
    }
    .expiry-notice strong {
      color: #92400e;
    }
    .url-fallback {
      word-break: break-all;
      color: #10b981;
      font-size: 13px;
      margin-top: 15px;
      padding: 10px;
      background-color: #f3f4f6;
      border-radius: 4px;
    }
    .footer {
      background-color: #f9fafb;
      padding: 25px;
      text-align: center;
      border-top: 1px solid #e5e7eb;
      font-size: 14px;
      color: #6b7280;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>✨ Welcome to Autobacs!</h1>
    </div>
    
    <div class="content">
      <div class="greeting">Hi ${name},</div>
      
      <div class="welcome-message">
        Thank you for joining Autobacs! We're thrilled to have you as part of our community. 
        To get started and unlock all features, please verify your email address.
      </div>
      
      <div class="button-container">
        <a href="${verifyUrl}" class="button">Verify My Email</a>
      </div>
      
      <div class="features">
        <h3>🚀 What's waiting for you:</h3>
        <ul>
          <li>Browse thousands of premium automotive products</li>
          <li>Save items to your wishlist for later</li>
          <li>Track your orders in real-time</li>
          <li>Manage multiple delivery addresses</li>
          <li>Get exclusive deals and personalized offers</li>
        </ul>
      </div>
      
      <div class="expiry-notice">
        <strong>⏰ Quick Reminder:</strong> This verification link will expire in ${expiresInHours} hours.
      </div>
      
      <div class="url-fallback">
        If the button doesn't work, copy and paste this link into your browser:<br>
        ${verifyUrl}
      </div>
      
      <p style="color: #6b7280; font-size: 14px; margin-top: 25px;">
        If you didn't create an account with Autobacs, you can safely ignore this email.
      </p>
    </div>
    
    <div class="footer">
      <p><strong>Autobacs</strong> - Premium Automotive Accessories</p>
      <p>Need help? Contact our support team</p>
      <p style="font-size: 12px; margin-top: 15px;">
        This is an automated email, please do not reply directly to this message.
      </p>
    </div>
  </div>
</body>
</html>
  `.trim();

  return { subject, text, html };
};

/**
 * Password Changed Notification Email
 * @param {Object} params
 * @param {string} params.name - User's name
 * @returns {Object} - { subject, text, html }
 */
export const passwordChangedEmail = ({ name }) => {
  const subject = 'Your Autobacs Password Has Been Changed';
  
  const text = `
Hi ${name},

This is a confirmation that the password for your Autobacs account was successfully changed.

If you made this change, no further action is required.

If you did NOT change your password, please contact our support team immediately as your account may have been compromised.

Best regards,
Autobacs Security Team
  `.trim();

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Password Changed</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      background-color: #f5f5f5;
      margin: 0;
      padding: 0;
    }
    .container {
      max-width: 600px;
      margin: 20px auto;
      background-color: #ffffff;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .header {
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      color: white;
      padding: 30px 20px;
      text-align: center;
    }
    .content {
      padding: 40px 30px;
    }
    .alert {
      background-color: #fef2f2;
      border-left: 4px solid #ef4444;
      padding: 20px;
      margin: 25px 0;
      border-radius: 4px;
    }
    .alert strong {
      color: #991b1b;
    }
    .footer {
      background-color: #f9fafb;
      padding: 25px;
      text-align: center;
      border-top: 1px solid #e5e7eb;
      font-size: 14px;
      color: #6b7280;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🔐 Password Changed</h1>
    </div>
    
    <div class="content">
      <p>Hi ${name},</p>
      
      <p>This is a confirmation that the password for your Autobacs account was successfully changed.</p>
      
      <p>If you made this change, no further action is required.</p>
      
      <div class="alert">
        <strong>⚠️ Didn't make this change?</strong><br>
        If you did NOT change your password, please contact our support team immediately as your account may have been compromised.
      </div>
    </div>
    
    <div class="footer">
      <p><strong>Autobacs Security Team</strong></p>
      <p>This is an automated security notification</p>
    </div>
  </div>
</body>
</html>
  `.trim();

  return { subject, text, html };
};

/**
 * Order Confirmation / Receipt Email Template
 * The full invoice travels as a PDF attachment; this email is the human-readable
 * summary. All amounts on the order are already in rupees (pricingService).
 * @param {Object} params
 * @param {Object} params.order - Order document
 * @param {Object} [params.user] - User document (name)
 * @param {Object} [params.company] - Company info (name, email)
 * @returns {Object} - { subject, text, html }
 */
export const orderConfirmationEmail = ({ order, user = null, company = {} }) => {
  const inr = (n) =>
    `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  // Same sequential number the attached PDF shows (falls back to AB-<id> if unassigned).
  const invNo = formatInvoiceNumber(order);
  const name = order.shippingAddress?.fullName || user?.name || 'there';
  const companyName = company.name || 'Autobacs India';
  const supportEmail = company.email || 'support@autobacsindia.com';
  const items = order.items || [];

  const subject = `Order confirmed — ${invNo}`;

  const itemsText = items
    .map((it) => `  • ${it.name || 'Item'} × ${it.quantity} — ${inr((it.price || 0) * (it.quantity || 0))}`)
    .join('\n');

  const text = `
Hi ${name},

Thank you for your order with ${companyName}. Your payment has been received and your order is confirmed.

Invoice No: ${invNo}

Items:
${itemsText}

Subtotal: ${inr(order.subtotal)}
${order.couponDiscount ? `Coupon discount: -${inr(order.couponDiscount)}\n` : ''}${order.karmaDiscount ? `Karma points: -${inr(order.karmaDiscount)}\n` : ''}Shipping: ${inr(order.shippingCost)}
Total Paid: ${inr(order.totalAmount)}

Your tax invoice is attached to this email as a PDF.

Questions? Contact us at ${supportEmail}.

Best regards,
${companyName}
  `.trim();

  const itemRows = items
    .map(
      (it) => `
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #eee;">${it.name || 'Item'}</td>
        <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:center;">${it.quantity}</td>
        <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;">${inr((it.price || 0) * (it.quantity || 0))}</td>
      </tr>`
    )
    .join('');

  const totalsRow = (label, value, bold = false) => `
      <tr>
        <td colspan="2" style="padding:4px 0;text-align:right;${bold ? 'font-weight:bold;' : 'color:#555;'}">${label}</td>
        <td style="padding:4px 0;text-align:right;${bold ? 'font-weight:bold;' : 'color:#555;'}">${value}</td>
      </tr>`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Order Confirmed</title>
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;line-height:1.6;color:#333;background:#f5f5f5;margin:0;padding:0;">
  <div style="max-width:600px;margin:20px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 4px rgba(0,0,0,0.1);">
    <div style="background:#111;padding:24px 30px;">
      <h1 style="color:#fff;margin:0;font-size:22px;">Order Confirmed ✅</h1>
    </div>
    <div style="padding:30px;">
      <p>Hi ${name},</p>
      <p>Thank you for your order with <strong>${companyName}</strong>. Your payment has been received and your order is confirmed.</p>
      <p style="color:#555;">Invoice No: <strong>${invNo}</strong></p>

      <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:14px;">
        <thead>
          <tr>
            <th style="text-align:left;padding:8px 0;border-bottom:2px solid #111;">Item</th>
            <th style="text-align:center;padding:8px 0;border-bottom:2px solid #111;">Qty</th>
            <th style="text-align:right;padding:8px 0;border-bottom:2px solid #111;">Amount</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
        <tfoot>
          ${totalsRow('Subtotal', inr(order.subtotal))}
          ${order.couponDiscount ? totalsRow(`Coupon${order.couponCode ? ` (${order.couponCode})` : ''}`, `- ${inr(order.couponDiscount)}`) : ''}
          ${order.karmaDiscount ? totalsRow('Karma points', `- ${inr(order.karmaDiscount)}`) : ''}
          ${totalsRow('Shipping', inr(order.shippingCost))}
          ${order.tax ? totalsRow('Tax (incl.)', inr(order.tax)) : ''}
          ${totalsRow('Total Paid', inr(order.totalAmount), true)}
        </tfoot>
      </table>

      <p style="margin-top:24px;background:#f0f9ff;border:1px solid #bae6fd;padding:12px;border-radius:6px;font-size:14px;">
        📎 Your tax invoice is attached to this email as a PDF.
      </p>
      <p style="font-size:13px;color:#999;margin-top:24px;">Questions? Contact us at ${supportEmail}.</p>
    </div>
    <div style="text-align:center;padding:20px;border-top:1px solid #eee;font-size:12px;color:#999;">
      <p style="margin:4px 0;">© ${new Date().getFullYear()} ${companyName}. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
  `.trim();

  return { subject, text, html };
};

/**
 * Welcome Email Template (sent on registration).
 * @param {Object} params
 * @param {string} [params.name] - User's name
 * @returns {Object} - { subject, text, html }
 */
export const welcomeEmail = ({ name } = {}) => {
  const firstName = (name || '').trim().split(' ')[0] || 'there';
  const subject = 'Welcome to Autobacs India 🎉';

  const text = `
Hi ${firstName},

Welcome to Autobacs India — we're glad to have you!

Your account is ready. You can now:
  • Shop genuine car care, accessories and parts
  • Track your orders in real time
  • Save your garage and get fitment-matched products

Browse the store: https://autobacsindia.com

If you have any questions, just reply to this email — we're happy to help.

See you on the road,
The Autobacs India Team
  `.trim();

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to Autobacs India</title>
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;line-height:1.6;color:#333;background:#f5f5f5;margin:0;padding:0;">
  <div style="max-width:600px;margin:20px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 4px rgba(0,0,0,0.1);">
    <div style="background:#111;padding:28px 30px;">
      <h1 style="color:#fff;margin:0;font-size:24px;">Welcome to Autobacs India 🎉</h1>
    </div>
    <div style="padding:30px;">
      <p>Hi ${firstName},</p>
      <p>We're glad to have you! Your account is ready to go.</p>
      <ul style="padding-left:20px;">
        <li>🛒 Shop genuine car care, accessories and parts</li>
        <li>📦 Track your orders in real time</li>
        <li>🚗 Save your garage and get fitment-matched products</li>
      </ul>
      <div style="text-align:center;margin:28px 0;">
        <a href="https://autobacsindia.com" style="display:inline-block;background:#111;color:#fff;padding:13px 28px;text-decoration:none;border-radius:6px;font-weight:bold;">Start Shopping</a>
      </div>
      <p style="font-size:13px;color:#999;">Questions? Just reply to this email — we're happy to help.</p>
    </div>
    <div style="text-align:center;padding:20px;border-top:1px solid #eee;font-size:12px;color:#999;">
      <p style="margin:4px 0;">© ${new Date().getFullYear()} Autobacs India. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
  `.trim();

  return { subject, text, html };
};

// Per-status copy for the fulfillment status-change email. Keeps orderStatusEmail
// declarative — subject/heading/blurb only; the delivered variant also lists items.
const STATUS_COPY = {
  shipped: {
    subject: (ref) => `Your order is on its way — ${ref}`,
    heading: 'Your order has shipped 🚚',
    blurb: 'Good news! Your order is on its way. You can track it from your account.',
  },
  delivered: {
    subject: (ref) => `Delivered — ${ref}`,
    heading: 'Your order has been delivered ✅',
    blurb: "Your order has been delivered. We hope you love it! Here's what arrived:",
  },
  cancelled: {
    subject: (ref) => `Your order was cancelled — ${ref}`,
    heading: 'Your order was cancelled',
    blurb: 'Your order has been cancelled. Any eligible refund will be processed to your original payment method.',
  },
  refunded: {
    subject: (ref) => `Refund processed — ${ref}`,
    heading: 'Your refund has been processed 💳',
    blurb: 'Your refund has been processed. It may take a few business days to reflect in your account, depending on your bank.',
  },
  // `returned` is the fulfillment status set when a return is completed (distinct from
  // `refunded`, the payment-axis outcome delivered via the Razorpay refund webhook). The
  // return-accepted email; the separate `refunded` email confirms the money movement.
  returned: {
    subject: (ref) => `Return completed — ${ref}`,
    heading: 'Your return is complete ↩️',
    blurb: 'We\'ve completed your return. Any eligible refund is processed to your original payment method and you\'ll get a separate confirmation once it\'s on its way.',
  },
};

/**
 * Fulfillment status-change email (shipped / delivered / cancelled / refunded).
 * The delivered variant lists the order's line items (name, qty, thumbnail).
 * @param {Object} params
 * @param {Object} params.order - Order document
 * @param {Object} [params.user] - User document (name)
 * @param {string} params.status - New status
 * @param {Object} [params.company] - Company info (name, email)
 * @returns {Object} - { subject, text, html }
 */
export const orderStatusEmail = ({ order, user = null, status, company = {} }) => {
  const copy = STATUS_COPY[status] || {
    subject: (ref) => `Order update — ${ref}`,
    heading: 'Your order status has been updated',
    blurb: `Your order status is now: ${status}.`,
  };
  const ref = `AB-${order._id.toString().slice(-8).toUpperCase()}`;
  const name = order.shippingAddress?.fullName || user?.name || 'there';
  const companyName = company.name || 'Autobacs India';
  const supportEmail = company.email || 'support@autobacsindia.com';
  const items = order.items || [];
  const showItems = status === 'delivered' && items.length > 0;

  // Escape HTML metacharacters before interpolating into the HTML body — the
  // tracking number is admin free-text and would otherwise break out of the
  // `href="..."` attribute or inject markup into the customer's email. (email XSS)
  const esc = (s) =>
    String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;');

  // Shipped emails carry a tracking block (number, carrier, ETA, tracking link)
  // plus a note when the courier slip PDF is attached.
  const showTracking = status === 'shipped' && !!order.trackingNumber;
  const carrierName = order.carrier?.name;
  const trackingUrl = order.carrier?.trackingUrl;
  const etaText = order.estimatedDelivery
    ? new Date(order.estimatedDelivery).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })
    : null;
  const hasSlip = status === 'shipped' && !!order.shippingSlip?.url;

  const subject = copy.subject(ref);

  const itemsText = showItems
    ? '\n\nItems:\n' + items.map((it) => `  • ${it.name || 'Item'} × ${it.quantity}`).join('\n')
    : '';

  const trackingText = showTracking
    ? '\n\nTracking details:' +
      `\n  • Tracking number: ${order.trackingNumber}` +
      (carrierName ? `\n  • Carrier: ${carrierName}` : '') +
      (etaText ? `\n  • Estimated delivery: ${etaText}` : '') +
      (trackingUrl ? `\n  • Track your package: ${trackingUrl}` : '') +
      (hasSlip ? '\n\nYour shipping slip is attached to this email.' : '')
    : '';

  const text = `
Hi ${name},

${copy.blurb}

Order: ${ref}${trackingText}${itemsText}

Questions? Contact us at ${supportEmail}.

Best regards,
${companyName}
  `.trim();

  const itemRows = showItems
    ? items
        .map(
          (it) => `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #eee;width:56px;">
          ${it.image ? `<img src="${it.image}" alt="" width="48" height="48" style="border-radius:6px;object-fit:cover;display:block;">` : ''}
        </td>
        <td style="padding:10px 0;border-bottom:1px solid #eee;">${it.name || 'Item'}</td>
        <td style="padding:10px 0;border-bottom:1px solid #eee;text-align:right;color:#555;">× ${it.quantity}</td>
      </tr>`
        )
        .join('')
    : '';

  const itemsTable = showItems
    ? `<table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:14px;"><tbody>${itemRows}</tbody></table>`
    : '';

  const trackingBlock = showTracking
    ? `
      <div style="margin-top:20px;padding:16px 20px;background:#f7f7f7;border-radius:8px;border:1px solid #eee;">
        <p style="margin:0 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:#888;">Tracking details</p>
        <p style="margin:4px 0;font-size:14px;">Tracking number: <strong>${esc(order.trackingNumber)}</strong></p>
        ${carrierName ? `<p style="margin:4px 0;font-size:14px;">Carrier: <strong>${esc(carrierName)}</strong></p>` : ''}
        ${etaText ? `<p style="margin:4px 0;font-size:14px;">Estimated delivery: <strong>${esc(etaText)}</strong></p>` : ''}
        ${trackingUrl ? `<p style="margin:16px 0 4px;"><a href="${esc(trackingUrl)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:14px;">Track your package</a></p>` : ''}
        ${hasSlip ? `<p style="margin:12px 0 0;font-size:13px;color:#666;">📎 Your shipping slip is attached to this email.</p>` : ''}
      </div>`
    : '';

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${copy.heading}</title>
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;line-height:1.6;color:#333;background:#f5f5f5;margin:0;padding:0;">
  <div style="max-width:600px;margin:20px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 4px rgba(0,0,0,0.1);">
    <div style="background:#111;padding:24px 30px;">
      <h1 style="color:#fff;margin:0;font-size:22px;">${copy.heading}</h1>
    </div>
    <div style="padding:30px;">
      <p>Hi ${name},</p>
      <p>${copy.blurb}</p>
      <p style="color:#555;">Order: <strong>${ref}</strong></p>
      ${trackingBlock}
      ${itemsTable}
      <p style="font-size:13px;color:#999;margin-top:24px;">Questions? Contact us at ${supportEmail}.</p>
    </div>
    <div style="text-align:center;padding:20px;border-top:1px solid #eee;font-size:12px;color:#999;">
      <p style="margin:4px 0;">© ${new Date().getFullYear()} ${companyName}. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
  `.trim();

  return { subject, text, html };
};

/**
 * Post-delivery review-request email — one CTA per purchased product.
 * @param {Object} params
 * @param {Object} params.order - Order document (for the order reference)
 * @param {Object} [params.user] - User document (name)
 * @param {Array<{name: string, slug: string, image: string}>} params.products - Reviewable products
 * @param {Object} [params.company] - Company info (name, email)
 * @returns {Object} - { subject, text, html }
 */
export const reviewRequestEmail = ({ order, user = null, products = [], company = {} }) => {
  const ref = `AB-${order._id.toString().slice(-8).toUpperCase()}`;
  const name = order.shippingAddress?.fullName || user?.name || 'there';
  const companyName = company.name || 'Autobacs India';
  const supportEmail = company.email || 'support@autobacsindia.com';
  const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
  const reviewUrl = (slug) => `${frontendUrl}/products/${slug}?review=1`;

  const subject = 'How did we do? Share your review 🌟';

  const text = `
Hi ${name},

Thanks for shopping with ${companyName} (order ${ref}). We'd love to hear what you think — your review helps other drivers choose with confidence.

${products.map((p) => `  • ${p.name}: ${reviewUrl(p.slug)}`).join('\n')}

It only takes a minute. Thank you!

Questions? Contact us at ${supportEmail}.

Best regards,
${companyName}
  `.trim();

  const productRows = products
    .map(
      (p) => `
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid #eee;width:64px;">
          ${p.image ? `<img src="${p.image}" alt="" width="56" height="56" style="border-radius:6px;object-fit:cover;display:block;">` : ''}
        </td>
        <td style="padding:12px 0;border-bottom:1px solid #eee;font-size:14px;">${p.name}</td>
        <td style="padding:12px 0;border-bottom:1px solid #eee;text-align:right;">
          <a href="${reviewUrl(p.slug)}" style="display:inline-block;background:#111;color:#fff;padding:8px 16px;text-decoration:none;border-radius:6px;font-size:13px;font-weight:bold;white-space:nowrap;">Write a review</a>
        </td>
      </tr>`
    )
    .join('');

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Share your review</title>
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;line-height:1.6;color:#333;background:#f5f5f5;margin:0;padding:0;">
  <div style="max-width:600px;margin:20px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 4px rgba(0,0,0,0.1);">
    <div style="background:#111;padding:24px 30px;">
      <h1 style="color:#fff;margin:0;font-size:22px;">How did we do? 🌟</h1>
    </div>
    <div style="padding:30px;">
      <p>Hi ${name},</p>
      <p>Thanks for shopping with <strong>${companyName}</strong> (order ${ref}). We'd love to hear what you think — your review helps other drivers choose with confidence.</p>
      <table style="width:100%;border-collapse:collapse;margin-top:16px;">
        <tbody>${productRows}</tbody>
      </table>
      <p style="font-size:13px;color:#999;margin-top:24px;">Questions? Contact us at ${supportEmail}.</p>
    </div>
    <div style="text-align:center;padding:20px;border-top:1px solid #eee;font-size:12px;color:#999;">
      <p style="margin:4px 0;">© ${new Date().getFullYear()} ${companyName}. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
  `.trim();

  return { subject, text, html };
};
