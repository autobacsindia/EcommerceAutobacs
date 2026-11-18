/**
 * Build the job-template index on a cluster. Production runs with autoIndex
 * off, so a deploy never builds schema indexes; config/db.js
 * ensureCriticalIndexes also builds this one at startup, and this script is the
 * explicit, checkable way to do it (or to confirm it is there).
 *
 *   staff_job_template_name   unique on nameKey — one template per name, so two
 *                             people saving "Fitting job" at once get one each
 *                             refused instead of two of the same name.
 *
 * The collection is new and empty, so building it is instant and safe while
 * the panel is live. Safe to run more than once. Run it after the deploy.
 *
 * Usage (from Back-end/server; prod via `railway run`, no dotenv):
 *   node scripts/create-job-template-index.js           # dry run: says what it would do
 *   node scripts/create-job-template-index.js --apply   # build it
 * Then: npm run audit-index-drift
 *
 * Rollback: db.staffjobtemplates.dropIndex('staff_job_template_name').
 */
import mongoose from 'mongoose';
import StaffJobTemplate from '../models/StaffJobTemplate.js';

const APPLY = process.argv.includes('--apply');
const TAG = '[job-template-index]';

export const INDEXES = [
  [{ nameKey: 1 }, { unique: true, name: 'staff_job_template_name' }],
];

export async function buildIndexes({ apply = APPLY, log = console.log } = {}) {
  const coll = StaffJobTemplate.collection;
  const existing = new Set((await coll.indexes().catch(() => [])).map((i) => i.name));
  const out = [];
  for (const [keys, options] of INDEXES) {
    if (existing.has(options.name)) out.push([options.name, 'already there']);
    else if (apply) {
      await coll.createIndex(keys, options);
      out.push([options.name, 'built']);
    } else out.push([options.name, 'would build']);
  }
  for (const [name, state] of out) log(`${TAG} ${name}: ${state}`);
  return out;
}

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI / MONGO_URI not set');
  // autoIndex off: importing the model must not build every declared index.
  await mongoose.connect(uri, { autoIndex: false });
  console.log(`${TAG} ${APPLY ? 'APPLY' : 'DRY RUN (add --apply to build)'}`);
  await buildIndexes();
  await mongoose.disconnect();
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch(async (err) => {
    console.error(`${TAG} failed:`, err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}
