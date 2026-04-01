/**
 * Email Handler Service
 * Handles all email notifications via SendGrid
 */

import sgMail from '@sendgrid/mail';

class EmailHandler {
  constructor() {
    this.isEnabled = false;
    this.fromEmail = null;
    this.fromName = null;
    this.retryAttempts = parseInt(process.env.NOTIFICATION_RETRY_ATTEMPTS || '3');
    this.retryDelay = parseInt(process.env.NOTIFICATION_RETRY_DELAY || '1000');
    
    this.initialize();
  }

  /**
   * Helper to log messages only in non-test environment
   */
  log(message) {
    if (process.env.NODE_ENV !== 'test') {
      console.log(message);
    }
  }

  /**
   * Helper to log errors only in non-test environment
   */
  error(message, ...args) {
    if (process.env.NODE_ENV !== 'test') {
      console.error(message, ...args);
    }
  }

  /**
   * Initialize SendGrid client and validate configuration
   */
  initialize() {
    const apiKey = process.env.SENDGRID_API_KEY;
    this.fromEmail = process.env.SENDGRID_FROM_EMAIL;
    this.fromName = process.env.SENDGRID_FROM_NAME || 'Autobacs';
    
    // Check if email notifications are enabled
    const enableEmail = process.env.ENABLE_EMAIL_NOTIFICATIONS !== 'false';
    
    // Check if running in test environment
    if (process.env.NODE_ENV === 'test') {
      // In test environment, suppress errors about missing keys
      if (!apiKey || !this.fromEmail) {
        // console.log('[EmailHandler] Test environment detected: Email notifications disabled (mock mode)');
        return;
      }
    }
    
    if (!enableEmail) {
      this.log('[EmailHandler] Email notifications disabled via configuration');
      return;
    }
    
    // Validate required credentials
    if (!apiKey) {
      this.error('[EmailHandler] SENDGRID_API_KEY not found in environment variables');
      this.error('[EmailHandler] Email notifications DISABLED');
      return;
    }
    
    if (!this.fromEmail) {
      this.error('[EmailHandler] SENDGRID_FROM_EMAIL not found in environment variables');
      this.error('[EmailHandler] Email notifications DISABLED');
      return;
    }
    
    // Validate email format
    if (!this.isValidEmail(this.fromEmail)) {
      this.error(`[EmailHandler] Invalid sender email format: ${this.fromEmail}`);
      this.error('[EmailHandler] Email notifications DISABLED');
      return;
    }
    
    try {
      // Initialize SendGrid
      sgMail.setApiKey(apiKey);
      this.isEnabled = true;
      this.log(`[EmailHandler] Initialized successfully with sender: ${this.fromEmail}`);
    } catch (error) {
      this.error('[EmailHandler] Failed to initialize SendGrid:', error.message);
      this.error('[EmailHandler] Email notifications DISABLED');
    }
  }

  /**
   * Send email with retry logic
   * @param {Object} options - Email options
   * @param {string} options.to - Recipient email
   * @param {string} options.subject - Email subject
   * @param {string} options.text - Plain text body
   * @param {string} options.html - HTML body (optional)
   * @returns {Promise<Object>} - Result with success status and details
   */
  async sendEmail({ to, subject, text, html }) {
    // Check if service is enabled
    if (!this.isEnabled) {
      return {
        success: false,
        error: 'Email service not enabled',
        provider: 'sendgrid',
        fallbackToConsole: true
      };
    }
    
    // Validate recipient email
    if (!this.isValidEmail(to)) {
      return {
        success: false,
        error: `Invalid recipient email: ${to}`,
        provider: 'sendgrid',
        retryable: false
      };
    }
    
    // Prepare email message
    const msg = {
      to,
      from: {
        email: this.fromEmail,
        name: this.fromName
      },
      subject,
      text,
      ...(html && { html })
    };
    
    // Attempt to send with retry logic
    let lastError = null;
    
    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        const response = await sgMail.send(msg);
        
        // SendGrid returns array of responses
        const messageId = response[0]?.headers['x-message-id'];
        
        this.log(`[EmailHandler] ✓ Email sent to ${to} | Subject: ${subject} | MessageID: ${messageId}`);
        
        return {
          success: true,
          provider: 'sendgrid',
          messageId,
          attempt,
          recipient: to
        };
        
      } catch (error) {
        lastError = error;
        
        // Check if error is retryable
        const isRetryable = this.isRetryableError(error);
        
        this.error(`[EmailHandler] ✗ Attempt ${attempt}/${this.retryAttempts} failed for ${to}:`, error.message);
        
        if (!isRetryable || attempt >= this.retryAttempts) {
          // Don't retry if error is not retryable or max attempts reached
          break;
        }
        
        // Exponential backoff delay
        const delay = this.retryDelay * Math.pow(2, attempt - 1);
        this.log(`[EmailHandler] Retrying in ${delay}ms...`);
        await this.sleep(delay);
      }
    }
    
    // All attempts failed
    return {
      success: false,
      provider: 'sendgrid',
      error: this.extractErrorMessage(lastError),
      statusCode: lastError?.code || lastError?.response?.status,
      retryable: this.isRetryableError(lastError),
      recipient: to
    };
  }

  /**
   * Check if error is retryable
   * @param {Error} error - Error object
   * @returns {boolean} - True if error is retryable
   */
  isRetryableError(error) {
    if (!error) return false;
    
    const statusCode = error.code || error.response?.status;
    
    // Non-retryable status codes
    const nonRetryable = [400, 401, 403, 404, 413];
    if (nonRetryable.includes(statusCode)) {
      return false;
    }
    
    // Retryable status codes (5xx server errors, rate limits, timeouts)
    const retryable = [408, 429, 500, 502, 503, 504];
    if (retryable.includes(statusCode)) {
      return true;
    }
    
    // Network errors are retryable
    if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
      return true;
    }
    
    return false;
  }

  /**
   * Extract user-friendly error message
   * @param {Error} error - Error object
   * @returns {string} - Error message
   */
  extractErrorMessage(error) {
    if (!error) return 'Unknown error';
    
    // SendGrid specific errors
    if (error.response?.body?.errors) {
      return error.response.body.errors.map(e => e.message).join(', ');
    }
    
    if (error.message) {
      return error.message;
    }
    
    return 'Failed to send email';
  }

  /**
   * Validate email format
   * @param {string} email - Email address
   * @returns {boolean} - True if valid
   */
  isValidEmail(email) {
    if (!email || typeof email !== 'string') return false;
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Sleep helper for retry delays
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise} - Promise that resolves after delay
   */
  sleep(ms) {
    if (process.env.NODE_ENV === 'test') {
      return Promise.resolve();
    }
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get handler status
   * @returns {Object} - Status information
   */
  getStatus() {
    return {
      enabled: this.isEnabled,
      provider: 'sendgrid',
      fromEmail: this.fromEmail,
      fromName: this.fromName,
      retryAttempts: this.retryAttempts,
      retryDelay: this.retryDelay
    };
  }

  /**
   * Send magic link email for guest account claiming
   * @param {string} to - Recipient email
   * @param {string} token - Magic link token
   * @param {string} orderId - Order ID (optional)
   * @returns {Promise<Object>} - Result with success status
   */
  async sendMagicLinkEmail(to, token, orderId) {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const magicUrl = `${frontendUrl}/claim-order?token=${token}${orderId ? `&orderId=${orderId}` : ''}`;
    
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>Claim Your Autobacs Order</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 28px;">🎉 Thank You for Your Order!</h1>
          </div>
          
          <div style="background: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px;">
            <h2 style="color: #2563eb; margin-top: 0;">Claim Your Account</h2>
            
            <p style="font-size: 16px; margin-bottom: 20px;">
              Hi there! 👋
            </p>
            
            <p style="font-size: 16px; margin-bottom: 20px;">
              You've just placed an order with Autobacs India. Click the button below to claim your account and:
            </p>
            
            <ul style="font-size: 16px; margin-bottom: 20px; padding-left: 20px;">
              <li>✅ Track your order in real-time</li>
              <li>✅ Get shipping updates</li>
              <li>✅ View order history</li>
              <li>✅ Easy returns & support</li>
            </ul>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${magicUrl}" 
                 style="display: inline-block; background: #2563eb; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-size: 16px; font-weight: bold; box-shadow: 0 4px 6px rgba(37, 99, 235, 0.2); transition: transform 0.2s;"
                 onmouseover="this.style.transform='translateY(-2px)'" 
                 onmouseout="this.style.transform='translateY(0)'">
                🚀 Claim My Account
              </a>
            </div>
            
            <p style="font-size: 14px; color: #666; margin: 20px 0;">
              Or copy and paste this link into your browser:
            </p>
            
            <div style="background: white; border: 2px dashed #ddd; padding: 12px; border-radius: 6px; word-break: break-all; font-size: 13px; color: #2563eb; font-family: monospace;">
              ${magicUrl}
            </div>
            
            <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
            
            <div style="background: #fff3cd; border: 1px solid #ffc107; padding: 15px; border-radius: 6px; font-size: 14px;">
              <strong>⏰ Important:</strong> This link expires in <strong>24 hours</strong>. 
              If you didn't place this order, please ignore this email.
            </div>
            
            <p style="margin-top: 30px; font-size: 14px; color: #999;">
              Questions? Reply to this email or contact us at support@autobacsindia.com
            </p>
          </div>
          
          <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #999;">
            <p style="margin: 5px 0;">© 2026 Autobacs India. All rights reserved.</p>
            <p style="margin: 5px 0;">This is an automated message, please do not reply.</p>
          </div>
        </body>
      </html>
    `;
    
    const text = `
      Claim Your Autobacs Order!
      
      Hi there!
      
      Thank you for your order with Autobacs India.
      
      Click the link below to claim your account and track your order:
      ${magicUrl}
      
      This link expires in 24 hours.
      
      If you didn't place this order, please ignore this email.
      
      Questions? Contact us at support@autobacsindia.com
      
      © 2026 Autobacs India
    `;
    
    return this.sendEmail({
      to,
      subject: '🎉 Claim Your Autobacs Order - Magic Link Inside',
      text,
      html
    });
  }
}

// Export singleton instance
export default new EmailHandler();
