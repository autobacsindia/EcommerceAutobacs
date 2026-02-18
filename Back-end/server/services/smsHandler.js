/**
 * SMS Handler Service
 * Handles all SMS notifications via Twilio
 */

import twilio from 'twilio';

class SmsHandler {
  constructor() {
    this.isEnabled = false;
    this.client = null;
    this.fromPhone = null;
    this.retryAttempts = parseInt(process.env.NOTIFICATION_RETRY_ATTEMPTS || '3');
    this.retryDelay = parseInt(process.env.NOTIFICATION_RETRY_DELAY || '1000');
    this.maxMessageLength = 160; // Single SMS unit
    
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
   * Initialize Twilio client and validate configuration
   */
  initialize() {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    this.fromPhone = process.env.TWILIO_PHONE_NUMBER;
    
    // Check if SMS notifications are enabled
    const enableSms = process.env.ENABLE_SMS_NOTIFICATIONS !== 'false';
    
    // Check if running in test environment
    if (process.env.NODE_ENV === 'test') {
      // In test environment, suppress errors about missing keys
      if (!accountSid || !authToken || !this.fromPhone) {
        return;
      }
    }
    
    if (!enableSms) {
      this.log('[SmsHandler] SMS notifications disabled via configuration');
      return;
    }
    
    // Validate required credentials
    if (!accountSid) {
      this.error('[SmsHandler] TWILIO_ACCOUNT_SID not found in environment variables');
      this.error('[SmsHandler] SMS notifications DISABLED');
      return;
    }
    
    if (!authToken) {
      this.error('[SmsHandler] TWILIO_AUTH_TOKEN not found in environment variables');
      this.error('[SmsHandler] SMS notifications DISABLED');
      return;
    }
    
    if (!this.fromPhone) {
      this.error('[SmsHandler] TWILIO_PHONE_NUMBER not found in environment variables');
      this.error('[SmsHandler] SMS notifications DISABLED');
      return;
    }
    
    // Validate phone number format
    if (!this.isValidPhoneFormat(this.fromPhone)) {
      this.error(`[SmsHandler] Invalid phone format: ${this.fromPhone}. Expected E.164 format (e.g., +91XXXXXXXXXX)`);
      this.error('[SmsHandler] SMS notifications DISABLED');
      return;
    }
    
    try {
      // Initialize Twilio client
      this.client = twilio(accountSid, authToken);
      this.isEnabled = true;
      this.log(`[SmsHandler] Initialized successfully with sender: ${this.fromPhone}`);
    } catch (error) {
      this.error('[SmsHandler] Failed to initialize Twilio:', error.message);
      this.error('[SmsHandler] SMS notifications DISABLED');
    }
  }

  /**
   * Send SMS with retry logic
   * @param {Object} options - SMS options
   * @param {string} options.to - Recipient phone number
   * @param {string} options.message - SMS message content
   * @returns {Promise<Object>} - Result with success status and details
   */
  async sendSms({ to, message }) {
    // Check if service is enabled
    if (!this.isEnabled) {
      return {
        success: false,
        error: 'SMS service not enabled',
        provider: 'twilio',
        fallbackToConsole: true
      };
    }
    
    // Format phone number to E.164
    const formattedPhone = this.formatPhoneNumber(to);
    
    if (!formattedPhone) {
      return {
        success: false,
        error: `Invalid phone number: ${to}`,
        provider: 'twilio',
        retryable: false
      };
    }
    
    // Truncate message if too long
    const truncatedMessage = this.truncateMessage(message);
    
    if (truncatedMessage !== message) {
      this.log(`[SmsHandler] Message truncated from ${message.length} to ${truncatedMessage.length} characters`);
    }
    
    // Attempt to send with retry logic
    let lastError = null;
    
    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        const response = await this.client.messages.create({
          body: truncatedMessage,
          from: this.fromPhone,
          to: formattedPhone
        });
        
        this.log(`[SmsHandler] ✓ SMS sent to ${formattedPhone} | SID: ${response.sid} | Status: ${response.status}`);
        
        return {
          success: true,
          provider: 'twilio',
          messageId: response.sid,
          messageSid: response.sid,
          status: response.status,
          attempt,
          recipient: formattedPhone,
          messageLength: truncatedMessage.length
        };
        
      } catch (error) {
        lastError = error;
        
        // Check if error is retryable
        const isRetryable = this.isRetryableError(error);
        
        this.error(`[SmsHandler] ✗ Attempt ${attempt}/${this.retryAttempts} failed for ${formattedPhone}:`, error.message);
        
        if (!isRetryable || attempt >= this.retryAttempts) {
          // Don't retry if error is not retryable or max attempts reached
          break;
        }
        
        // Exponential backoff delay
        const delay = this.retryDelay * Math.pow(2, attempt - 1);
        this.log(`[SmsHandler] Retrying in ${delay}ms...`);
        await this.sleep(delay);
      }
    }
    
    // All attempts failed
    return {
      success: false,
      provider: 'twilio',
      error: this.extractErrorMessage(lastError),
      errorCode: lastError?.code,
      statusCode: lastError?.status,
      retryable: this.isRetryableError(lastError),
      recipient: formattedPhone
    };
  }

  /**
   * Format phone number to E.164 international format
   * @param {string} phone - Phone number
   * @returns {string|null} - Formatted phone or null if invalid
   */
  formatPhoneNumber(phone) {
    if (!phone || typeof phone !== 'string') return null;
    
    // Remove all non-digit characters
    let cleaned = phone.replace(/\D/g, '');
    
    // If already in E.164 format, validate and return
    if (phone.startsWith('+')) {
      if (this.isValidPhoneFormat(phone)) {
        return phone;
      }
      return null;
    }
    
    // Handle India numbers specifically
    // India country code is +91
    if (cleaned.length === 10) {
      // Assume it's an Indian number without country code
      cleaned = '91' + cleaned;
    } else if (cleaned.length === 12 && cleaned.startsWith('91')) {
      // Already has country code
    } else if (cleaned.length === 11 && cleaned.startsWith('0')) {
      // Remove leading 0 and add country code
      cleaned = '91' + cleaned.substring(1);
    } else {
      // Unknown format
      return null;
    }
    
    const formatted = '+' + cleaned;
    
    // Validate the formatted number
    return this.isValidPhoneFormat(formatted) ? formatted : null;
  }

  /**
   * Validate phone number format (E.164)
   * @param {string} phone - Phone number
   * @returns {boolean} - True if valid
   */
  isValidPhoneFormat(phone) {
    if (!phone || typeof phone !== 'string') return false;
    
    // E.164 format: +[country code][number]
    // Length: 10-15 digits (excluding +)
    const e164Regex = /^\+[1-9]\d{9,14}$/;
    return e164Regex.test(phone);
  }

  /**
   * Truncate message to fit single SMS unit
   * @param {string} message - Original message
   * @returns {string} - Truncated message
   */
  truncateMessage(message) {
    if (!message || message.length <= this.maxMessageLength) {
      return message;
    }
    
    // Truncate and add indicator
    const indicator = '...';
    const maxContent = this.maxMessageLength - indicator.length;
    return message.substring(0, maxContent) + indicator;
  }

  /**
   * Check if error is retryable
   * @param {Error} error - Error object
   * @returns {boolean} - True if error is retryable
   */
  isRetryableError(error) {
    if (!error) return false;
    
    // Twilio error codes
    const nonRetryableCodes = [
      21211, // Invalid phone number
      21401, // Invalid phone number format
      21608, // Unsubscribed recipient
      21610, // Blacklisted phone number
      21614, // Invalid mobile number
      30007, // Message filtered (spam)
      21606  // Phone not capable of receiving SMS
    ];
    
    if (nonRetryableCodes.includes(error.code)) {
      return false;
    }
    
    // HTTP status codes
    const statusCode = error.status;
    
    // Authentication errors are not retryable
    if (statusCode === 401 || statusCode === 403) {
      return false;
    }
    
    // Server errors and rate limits are retryable
    if (statusCode >= 500 || statusCode === 429) {
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
    
    // Twilio specific errors
    if (error.message) {
      return error.message;
    }
    
    if (error.code) {
      return `Twilio error code: ${error.code}`;
    }
    
    return 'Failed to send SMS';
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
      provider: 'twilio',
      fromPhone: this.fromPhone,
      retryAttempts: this.retryAttempts,
      retryDelay: this.retryDelay,
      maxMessageLength: this.maxMessageLength
    };
  }
}

// Export singleton instance
export default new SmsHandler();
