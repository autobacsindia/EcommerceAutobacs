#!/usr/bin/env node
/**
 * One-time migration: trim loginAttempts arrays to the last 50 entries.
 *
 * Usage:
 *   node scripts/trim-login-attempts.js
 *   node scripts/trim-login-attempts.js --dry-run
 *
 * Safe to run on a live database — updateMany with $push/$slice is atomic
 * per document and does not lock the collection.
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../.env') });

const DRY_RUN = process.argv.includes('--dry-run');

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('MONGO_URI not found in environment variables');
  process.exit(1);
}

await mongoose.connect(MONGO_URI);
console.log('Connected to MongoDB');

// 'loginAttempts.50' exists only when the array has at least 51 elements.
const filter = { 'loginAttempts.50': { $exists: true } };

const count = await mongoose.connection.collection('users').countDocuments(filter);
console.log(`Found ${count} user(s) with more than 50 login attempts`);

if (count === 0 || DRY_RUN) {
  if (DRY_RUN && count > 0) console.log('Dry-run mode — no changes written');
  await mongoose.disconnect();
  process.exit(0);
}

// $push with $each: [] and $slice: -50 trims without adding new entries.
const result = await mongoose.connection.collection('users').updateMany(
  filter,
  { $push: { loginAttempts: { $each: [], $slice: -50 } } }
);

console.log(`Trimmed ${result.modifiedCount} document(s)`);
await mongoose.disconnect();
