/**
 * One-time script: sanitize existing DB data for XSS
 *
 * Applies cleanHTML() to all existing rich-text fields:
 *   - Product.description, Product.shortDescription
 *   - Review.title, Review.comment
 *   - ProductQuestion.question, ProductQuestion.answer
 *
 * Run once:
 *   node sanitize-existing-data.js
 *
 * Safe to re-run (idempotent — cleanHTML is idempotent for already-clean text).
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import { connectWithRetry } from './config/db.js';
import { cleanHTML } from './utils/htmlSanitizer.js';
import Product from './models/Product.js';
import Review from './models/Review.js';
import ProductQuestion from './models/ProductQuestion.js';

const BATCH = 200; // docs per bulk write

async function sanitizeCollection({ label, Model, fields }) {
  let updated = 0;
  let skip = 0;

  while (true) {
    const docs = await Model.find({}).select(fields.join(' ')).skip(skip).limit(BATCH).lean();
    if (!docs.length) break;

    const ops = [];
    for (const doc of docs) {
      const set = {};
      for (const field of fields) {
        const val = doc[field];
        if (val && typeof val === 'string') {
          const clean = cleanHTML(val);
          if (clean !== val) set[field] = clean;
        }
      }
      if (Object.keys(set).length) {
        ops.push({ updateOne: { filter: { _id: doc._id }, update: { $set: set } } });
      }
    }

    if (ops.length) {
      await Model.bulkWrite(ops, { ordered: false });
      updated += ops.length;
    }

    skip += BATCH;
    process.stdout.write(`\r[${label}] scanned ${skip} | updated ${updated}`);
  }

  console.log(`\n[${label}] done — ${updated} documents sanitized`);
}

async function main() {
  console.log('Connecting to MongoDB...');
  await connectWithRetry();
  console.log('Connected.\n');

  await sanitizeCollection({
    label: 'Product',
    Model: Product,
    fields: ['description', 'shortDescription'],
  });

  await sanitizeCollection({
    label: 'Review',
    Model: Review,
    fields: ['title', 'comment'],
  });

  await sanitizeCollection({
    label: 'ProductQuestion',
    Model: ProductQuestion,
    fields: ['question', 'answer'],
  });

  console.log('\nAll done. Closing connection.');
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
