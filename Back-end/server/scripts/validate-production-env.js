/**
 * Production Environment Validation Script
 * 
 * Validates all required environment variables are set correctly before deployment
 * Run this script as part of CI/CD pipeline or before starting production server
 * 
 * Usage: node scripts/validate-production-env.js
 */

import dotenv from 'dotenv';

dotenv.config();

const requiredEnvVars = {
  // Database
  MONGO_URI: {
    description: 'MongoDB connection string',
    validate: (value) => {
      if (!value.startsWith('mongodb+srv://') && !value.startsWith('mongodb://')) {
        return 'Must be a valid MongoDB URI (mongodb:// or mongodb+srv://)';
      }
      if (value.includes('<username>') || value.includes('<password>')) {
        return 'Contains placeholder values - replace with actual credentials';
      }
      return null;
    }
  },
  
  // JWT
  JWT_SECRET: {
    description: 'JWT signing secret',
    validate: (value) => {
      if (value.length < 64) {
        return `Too short (${value.length} chars) - minimum 64 characters required`;
      }
      return null;
    }
  },
  
  // Server
  NODE_ENV: {
    description: 'Node environment',
    validate: (value) => {
      if (value !== 'production') {
        return `Should be "production" in production environment (currently "${value}")`;
      }
      return null;
    }
  },
  
  // Frontend CORS
  FRONTEND_URL: {
    description: 'Frontend URL for CORS',
    validate: (value) => {
      if (!value) return 'Required in production';
      if (value.includes('localhost')) {
        return 'Should not contain localhost in production';
      }
      if (!value.startsWith('https://')) {
        return 'Should use HTTPS in production';
      }
      return null;
    }
  },
  
  // Payment Gateway
  RAZORPAY_KEY_ID: {
    description: 'Razorpay key ID',
    validate: (value) => {
      if (!value) return 'Required for payment processing';
      if (value.startsWith('rzp_test_')) {
        return 'Using TEST key - must use LIVE key (rzp_live_*) in production';
      }
      if (!value.startsWith('rzp_live_')) {
        return 'Invalid format - should start with rzp_live_';
      }
      return null;
    }
  },
  
  RAZORPAY_KEY_SECRET: {
    description: 'Razorpay key secret',
    validate: (value) => {
      if (!value) return 'Required for payment processing';
      if (value.length < 10) {
        return 'Too short - should be at least 10 characters';
      }
      return null;
    }
  },
  
  // Email Service
  SENDGRID_API_KEY: {
    description: 'SendGrid API key for email notifications',
    validate: (value) => {
      if (!value) return 'Required for email notifications';
      if (!value.startsWith('SG.')) {
        return 'Invalid format - should start with SG.';
      }
      return null;
    }
  },
  
  // Cloud Storage
  CLOUDINARY_CLOUD_NAME: {
    description: 'Cloudinary cloud name for image storage',
    validate: (value) => {
      if (!value) return 'Required for image uploads';
      return null;
    }
  },
  
  CLOUDINARY_API_KEY: {
    description: 'Cloudinary API key',
    validate: (value) => {
      if (!value) return 'Required for image uploads';
      return null;
    }
  },
  
  CLOUDINARY_API_SECRET: {
    description: 'Cloudinary API secret',
    validate: (value) => {
      if (!value) return 'Required for image uploads';
      return null;
    }
  },
  
  // OAuth (optional but recommended)
  GOOGLE_CLIENT_ID: {
    description: 'Google OAuth client ID',
    required: false,
    validate: (value) => {
      if (value && !value.includes('.apps.googleusercontent.com')) {
        return 'Invalid format - should end with .apps.googleusercontent.com';
      }
      return null;
    }
  },
  
  // Redis (optional but recommended for production)
  REDIS_URL: {
    description: 'Primary Redis (Upstash) for cache, sessions, CSRF',
    required: false,
    validate: (value) => {
      if (value && !value.startsWith('redis://') && !value.startsWith('rediss://')) {
        return 'Invalid format - should start with redis:// or rediss://';
      }
      return null;
    }
  },

  // Dedicated Redis for BullMQ queues + rate-limit. Falls back to REDIS_URL if unset.
  QUEUE_REDIS_URL: {
    description: 'Dedicated Redis for BullMQ + rate-limit (falls back to REDIS_URL)',
    required: false,
    validate: (value) => {
      if (value && !value.startsWith('redis://') && !value.startsWith('rediss://')) {
        return 'Invalid format - should start with redis:// or rediss://';
      }
      return null;
    }
  },

  // Cookie portability (for Vercel/Railway interim and eventual same-site cutover)
  COOKIE_DOMAIN: {
    description: 'Cookie Domain attr, e.g. .autobacsindia.com at cutover (unset = host-only)',
    required: false,
    validate: () => null,
  },
  COOKIE_SAMESITE: {
    description: 'Cookie SameSite: none (cross-site interim) | lax | strict',
    required: false,
    validate: (value) => {
      if (value && !['lax', 'strict', 'none'].includes(value.toLowerCase())) {
        return 'Invalid - must be lax, strict, or none';
      }
      return null;
    }
  },

  // Sentry (optional but recommended)
  SENTRY_DSN: {
    description: 'Sentry DSN for error tracking',
    required: false,
    validate: (value) => {
      if (value && !value.startsWith('https://')) {
        return 'Invalid format - should be a valid Sentry DSN URL';
      }
      return null;
    }
  }
};

// Optional env vars that should NOT be set in production
const forbiddenEnvVars = {
  // None currently, but add any here that should not be in production
};

function validateEnvironment() {
  console.log('=== Production Environment Validation ===\n');
  
  const errors = [];
  const warnings = [];
  const successes = [];
  
  // Check required variables
  for (const [varName, config] of Object.entries(requiredEnvVars)) {
    const value = process.env[varName];
    
    if (!value && config.required !== false) {
      errors.push(`${varName}: Missing - ${config.description}`);
      continue;
    }
    
    if (!value) {
      warnings.push(`${varName}: Not set (optional)`);
      continue;
    }
    
    // Validate value
    if (config.validate) {
      const error = config.validate(value);
      if (error) {
        errors.push(`${varName}: ${error}`);
      } else {
        successes.push(`${varName}: ✓ Valid`);
      }
    } else {
      successes.push(`${varName}: ✓ Set`);
    }
  }
  
  // Check forbidden variables
  for (const [varName, description] of Object.entries(forbiddenEnvVars)) {
    if (process.env[varName]) {
      errors.push(`${varName}: Should not be set in production - ${description}`);
    }
  }
  
  // Security checks
  if (process.env.NODE_ENV === 'production') {
    // Check for localhost references
    const localhostVars = [];
    for (const [varName, value] of Object.entries(process.env)) {
      if (typeof value === 'string' && value.includes('localhost')) {
        localhostVars.push(varName);
      }
    }
    
    if (localhostVars.length > 0) {
      warnings.push(`WARNING: The following variables contain "localhost": ${localhostVars.join(', ')}`);
    }
    
    // Check for placeholder values
    const placeholderVars = [];
    for (const [varName, value] of Object.entries(process.env)) {
      if (typeof value === 'string' && 
          (value.includes('your_') || value.includes('<') || value.includes('changeme'))) {
        placeholderVars.push(varName);
      }
    }
    
    if (placeholderVars.length > 0) {
      errors.push(`ERROR: The following variables contain placeholder values: ${placeholderVars.join(', ')}`);
    }
  }
  
  // Print results
  console.log('✓ Successful validations:');
  successes.forEach(msg => console.log(`  ${msg}`));
  
  if (warnings.length > 0) {
    console.log('\n⚠ Warnings:');
    warnings.forEach(msg => console.log(`  ${msg}`));
  }
  
  if (errors.length > 0) {
    console.log('\n✗ Errors:');
    errors.forEach(msg => console.error(`  ${msg}`));
  }
  
  // Summary
  console.log('\n=== Validation Summary ===');
  console.log(`Passed: ${successes.length}`);
  console.log(`Warnings: ${warnings.length}`);
  console.log(`Errors: ${errors.length}`);
  
  if (errors.length > 0) {
    console.error('\n✗ Environment validation FAILED');
    console.error('Fix the errors above before deploying to production');
    process.exit(1);
  } else {
    console.log('\n✓ Environment validation PASSED');
    if (warnings.length > 0) {
      console.log('  (with warnings - review before deploying)');
    }
    process.exit(0);
  }
}

// Run validation
validateEnvironment();
