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
   * Initialize SendGrid client and validate configuration
   */
  initialize() {
    const apiKey = process.env.SENDGRID_API_KEY;
    this.fromEmail = process.env.SENDGRID_FROM_EMAIL;
    this.fromName = process.env.SENDGRID_FROM_NAME || 'Autobacs';
    
    // Check if email notifications are enabled
    const enableEmail = process.env.ENABLE_EMAIL_NOTIFICATIONS !== 'false';
    
    if (!enableEmail) {
      console.log('[EmailHandler] Email notifications disabled via configuration');
      return;
    }
    
    // Validate required credentials
    if (!apiKey) {
      console.error('[EmailHandler] SENDGRID_API_KEY not found in environment variables');
      console.error('[EmailHandler] Email notifications DISABLED');
      return;
    }
    
    if (!this.fromEmail) {
      console.error('[EmailHandler] SENDGRID_FROM_EMAIL not found in environment variables');
      console.error('[EmailHandler] Email notifications DISABLED');
      return;
    }
    
    // Validate email format
    if (!this.isValidEmail(this.fromEmail)) {
      console.error(`[EmailHandler] Invalid sender email format: ${this.fromEmail}`);
      console.error('[EmailHandler] Email notifications DISABLED');
      return;
    }
    
    try {
      // Initialize SendGrid
      sgMail.setApiKey(apiKey);
      this.isEnabled = true;
      console.log(`[EmailHandler] Initialized successfully with sender: ${this.fromEmail}`);
    } catch (error) {
      console.error('[EmailHandler] Failed to initialize SendGrid:', error.message);
      console.error('[EmailHandler] Email notifications DISABLED');
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
        
        console.log(`[EmailHandler] ✓ Email sent to ${to} | Subject: ${subject} | MessageID: ${messageId}`);
        
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
        
        console.error(`[EmailHandler] ✗ Attempt ${attempt}/${this.retryAttempts} failed for ${to}:`, error.message);
        
        if (!isRetryable || attempt >= this.retryAttempts) {
          // Don't retry if error is not retryable or max attempts reached
          break;
        }
        
        // Exponential backoff delay
        const delay = this.retryDelay * Math.pow(2, attempt - 1);
        console.log(`[EmailHandler] Retrying in ${delay}ms...`);
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
}

// Export singleton instance
export default new EmailHandler();
