// Environment Configuration Checker
// Run this script to verify your .env.local configuration

const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env.local') });

console.log('=== Environment Configuration Check ===\n');

// WordPress API Configuration
console.log('WordPress API Configuration:');
console.log('----------------------------');
console.log('NEXT_PUBLIC_WORDPRESS_SITE_URL:', process.env.NEXT_PUBLIC_WORDPRESS_SITE_URL || 'NOT SET');
console.log('NEXT_PUBLIC_WORDPRESS_API_VERSION:', process.env.NEXT_PUBLIC_WORDPRESS_API_VERSION || 'NOT SET');
console.log('NEXT_PUBLIC_WORDPRESS_CONSUMER_KEY:', process.env.NEXT_PUBLIC_WORDPRESS_CONSUMER_KEY ? 'SET' : 'NOT SET');
console.log('NEXT_PUBLIC_WORDPRESS_CONSUMER_SECRET:', process.env.NEXT_PUBLIC_WORDPRESS_CONSUMER_SECRET ? 'SET' : 'NOT SET');

const wpConfigured = !!(process.env.NEXT_PUBLIC_WORDPRESS_SITE_URL && 
                       process.env.NEXT_PUBLIC_WORDPRESS_CONSUMER_KEY && 
                       process.env.NEXT_PUBLIC_WORDPRESS_CONSUMER_SECRET);

console.log('\nWordPress API Fully Configured:', wpConfigured ? 'YES' : 'NO');

if (!wpConfigured) {
  const missing = [];
  if (!process.env.NEXT_PUBLIC_WORDPRESS_SITE_URL) missing.push('NEXT_PUBLIC_WORDPRESS_SITE_URL');
  if (!process.env.NEXT_PUBLIC_WORDPRESS_CONSUMER_KEY) missing.push('NEXT_PUBLIC_WORDPRESS_CONSUMER_KEY');
  if (!process.env.NEXT_PUBLIC_WORDPRESS_CONSUMER_SECRET) missing.push('NEXT_PUBLIC_WORDPRESS_CONSUMER_SECRET');
  
  // Razorpay
  if (!process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID) {
    missing.push('NEXT_PUBLIC_RAZORPAY_KEY_ID');
  } else if (process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID === 'your_razorpay_key_id_here') {
    missing.push('NEXT_PUBLIC_RAZORPAY_KEY_ID (Found placeholder value)');
  }
  
  console.log('Missing configuration:', missing.join(', '));
}

// Backend API Configuration
console.log('\n\nBackend API Configuration:');
console.log('-------------------------');
console.log('NEXT_PUBLIC_API_BASE_URL:', process.env.NEXT_PUBLIC_API_BASE_URL || 'NOT SET (defaults to http://localhost:5000)');
console.log('NEXT_PUBLIC_API_URL:', process.env.NEXT_PUBLIC_API_URL || 'NOT SET');

console.log('\n=== Configuration Check Complete ===');