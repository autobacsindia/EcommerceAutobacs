import dotenv from 'dotenv';
import Razorpay from 'razorpay';

dotenv.config();

console.log('--- Razorpay Configuration Check ---');

const keyId = process.env.RAZORPAY_KEY_ID;
const keySecret = process.env.RAZORPAY_KEY_SECRET;

console.log(`Key ID Present: ${!!keyId}`);
console.log(`Key Secret Present: ${!!keySecret}`);

if (!keyId || !keySecret) {
  console.error('ERROR: Missing Razorpay credentials in .env');
  process.exit(1);
}

console.log(`Key ID: ${keyId}`);
// console.log(`Key Secret: ${keySecret}`); // Don't log secret

try {
  const instance = new Razorpay({
    key_id: keyId,
    key_secret: keySecret
  });
  console.log('Razorpay instance initialized successfully.');
} catch (error) {
  console.error('ERROR: Failed to initialize Razorpay instance:', error.message);
  process.exit(1);
}

console.log('--- Check Complete ---');
