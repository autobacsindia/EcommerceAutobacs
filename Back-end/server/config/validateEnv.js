/**
 * Environment Configuration Validator
 * 
 * Centralized validation of all critical environment variables.
 * Ensures production deployments have complete configuration.
 * 
 * This prevents:
 * - Partial deployments (common in CI/CD)
 * - Runtime crashes after startup
 * - Insecure configurations in production
 */

const requiredEnvVars = [
  'JWT_SECRET',
  'MONGO_URI',
];

const productionOnlyVars = [
  'FRONTEND_URL',
  'RAZORPAY_WEBHOOK_SECRET',
];

/**
 * Validate all required environment variables
 * @throws {Error} If any required variable is missing
 */
export function validateEnvironment() {
  const isProd = process.env.NODE_ENV === 'production';
  const errors = [];

  // Check all required variables
  requiredEnvVars.forEach((key) => {
    if (!process.env[key]) {
      errors.push(`Missing required environment variable: ${key}`);
    }
  });

  // Check production-only variables
  if (isProd) {
    productionOnlyVars.forEach((key) => {
      if (!process.env[key]) {
        errors.push(`Missing production environment variable: ${key}`);
      }
    });

    // Validate FRONTEND_URL is HTTPS in production
    if (process.env.FRONTEND_URL && !process.env.FRONTEND_URL.startsWith('https://')) {
      errors.push('FRONTEND_URL must use HTTPS in production');
    }
  }

  // Validate JWT_SECRET length (only if it exists)
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 64) {
    errors.push(
      `JWT_SECRET is too short (${process.env.JWT_SECRET.length} chars, minimum 64). ` +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"'
    );
  }

  // If there are errors, fail fast
  if (errors.length > 0) {
    console.error('✗ Environment validation failed:');
    errors.forEach((err) => console.error(`  - ${err}`));
    console.error('');
    console.error('FIX: Set all required environment variables before starting the application');
    process.exit(1);
  }

  // Success logging
  console.log('[Config] ✓ All required environment variables validated');
  
  if (isProd) {
    console.log('[Config] ✓ Production configuration validated');
    console.log(`[Config] ✓ FRONTEND_URL: ${process.env.FRONTEND_URL}`);
  }
}

/**
 * Log sanitized environment info (NO SECRETS)
 * Safe for production logging
 */
export function logEnvironmentInfo() {
  const isProd = process.env.NODE_ENV === 'production';
  
  console.log('[Config] Environment:', {
    NODE_ENV: process.env.NODE_ENV || 'undefined',
    PORT: process.env.PORT || 'default',
    JWT_SECRET: process.env.JWT_SECRET ? `✓ Set (${process.env.JWT_SECRET.length} chars)` : '✗ Missing',
    MONGO_URI: process.env.MONGO_URI ? '✓ Set' : '✗ Missing',
    REDIS_URL: process.env.REDIS_URL ? '✓ Set' : '✗ Not configured',
    FRONTEND_URL: process.env.FRONTEND_URL || 'Not set',
    RAZORPAY_WEBHOOK_SECRET: process.env.RAZORPAY_WEBHOOK_SECRET ? '✓ Set' : '✗ Missing',
    SENTRY_DSN: process.env.SENTRY_DSN ? '✓ Set' : '✗ Not configured',
  });

  // WARNING: Never log actual secret values
  if (!isProd) {
    console.log('[Config] ⚠ Running in development mode - verbose logging enabled');
  }
}
