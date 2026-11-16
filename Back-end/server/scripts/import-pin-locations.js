/**
 * Load PIN → lat/long (India Post "All India Pincode Directory", data.gov.in, free)
 * into `pinlocations`, for the delivery-fee distance band.
 *
 * Usage (dry run by default — reads the file, writes nothing):
 *   node scripts/import-pin-locations.js /path/to/pincode.csv
 *   node scripts/import-pin-locations.js /path/to/pincode.csv --apply
 *
 * Against production: `railway run node scripts/import-pin-locations.js <csv> --apply`
 * (no dotenv here on purpose: the local .env points at the test cluster).
 *
 * Idempotent: upserts by PIN, so a re-run with a newer file updates in place.
 * ROLLBACK: `db.pinlocations.drop()` — nothing else reads this collection, and a
 * missing PIN simply prices at the highest distance band.
 */
import fs from 'fs';
import mongoose from 'mongoose';
import PinLocation from '../models/PinLocation.js';
import { parsePinDirectory } from '../utils/pinLocationCsv.js';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const file = args.find((a) => !a.startsWith('--'));
const BATCH = 1000;

async function main() {
  if (!file) throw new Error('Pass the CSV path: node scripts/import-pin-locations.js <file.csv> [--apply]');
  const { rows, stats } = parsePinDirectory(fs.readFileSync(file, 'utf8'));
  console.log('Parsed:', stats);
  console.log('Sample:', rows.slice(0, 3));
  if (!APPLY) {
    console.log(`DRY RUN — would upsert ${rows.length} PIN locations. Re-run with --apply.`);
    return;
  }
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI (or MONGO_URI) not set');
  // autoIndex OFF: merely connecting must never build every model's indexes on prod.
  await mongoose.connect(uri, { autoIndex: false });
  await mongoose.connection.db.collection('pinlocations').createIndex({ pin: 1 }, { unique: true, name: 'pin_1' });
  let upserted = 0;
  let modified = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const res = await PinLocation.bulkWrite(
      rows.slice(i, i + BATCH).map((r) => ({ updateOne: { filter: { pin: r.pin }, update: { $set: r }, upsert: true } })),
      { ordered: false },
    );
    upserted += res.upsertedCount || 0;
    modified += res.modifiedCount || 0;
  }
  console.log(`Done: ${upserted} new, ${modified} updated, total ${await PinLocation.estimatedDocumentCount()}.`);
  console.log('Rollback: db.pinlocations.drop()');
}

main()
  .catch((err) => { console.error(err.message); process.exitCode = 1; })
  .finally(() => mongoose.disconnect().catch(() => {}));
