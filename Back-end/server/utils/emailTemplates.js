/**
 * Email Templates for Authentication
 * HTML and text templates for password reset and email verification
 */

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
