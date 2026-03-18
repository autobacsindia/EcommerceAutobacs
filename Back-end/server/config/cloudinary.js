/**
 * Cloudinary v2 SDK Configuration
 * Initializes and exports a configured Cloudinary instance.
 * NEVER import this on the frontend — API_SECRET must stay server-side only.
 */
import { v2 as cloudinary } from 'cloudinary';

const requiredVars = [
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
];

// Fail fast in production if env vars are missing
if (process.env.NODE_ENV === 'production') {
  const missing = requiredVars.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    throw new Error(
      `[Cloudinary] Missing required environment variables: ${missing.join(', ')}`
    );
  }
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure:     true, // always use https URLs
});

export default cloudinary;
