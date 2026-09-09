process.env.JWT_SECRET = 'test-secret-key-123';
process.env.NODE_ENV = 'test';
process.env.PORT = 5001;
process.env.MONGODB_URI = 'mongodb://localhost:27017/test-db';
process.env.RAZORPAY_KEY_ID = 'rzp_test_1234567890abcdef';
process.env.RAZORPAY_KEY_SECRET = 'test_secret_key_1234567890abcdef';
process.env.SENDGRID_API_KEY = 'SG.test_key_1234567890abcdef';
process.env.SENDGRID_FROM_EMAIL = 'test@example.com';
process.env.EMAIL_FROM = 'test@example.com';
process.env.WORDPRESS_SITE_URL = 'http://example.com';
process.env.WORDPRESS_API_KEY = 'ck_test_123';
process.env.WORDPRESS_API_SECRET = 'cs_test_123';

/*
  Field-encryption key for the affiliate PAN / bank account (utils/fieldEncryption.js).

  Fixed rather than random so a value encrypted in one test file can be decrypted in
  another, and so a failure is reproducible. `encryptField` REFUSES to run without a key
  rather than silently storing plaintext, so any suite that writes payout details needs
  one — and production always has one, so supplying it here is the faithful default.

  32 bytes, base64. Obviously not a secret: it exists only in the test process.
*/
process.env.FIELD_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
