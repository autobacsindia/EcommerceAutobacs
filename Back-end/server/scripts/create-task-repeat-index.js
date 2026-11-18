/**
 * Build the repeating-task index on a cluster. Production runs with autoIndex
 * off, so a deploy never builds schema indexes; config/db.js
 * ensureCriticalIndexes also builds this one at startup, and this script is the
 * explicit, checkable way to do it (or to confirm it is there).
 *
 *   staff_task_repeat_of   unique on repeatOf, partial { repeatOf: { $type: 'objectId' } }
 *                          — one next copy per repeating task, so "done" twice,
 *                          a retry, or reopen-then-done makes ONE copy.
 *
 * No existing task has `repeatOf`, so the partial index starts empty: building
 * it is instant and safe while the panel is live. Safe to run more than once.
 * Run it right after the code is deployed.
 *
 * Usage (from Back-end/server; prod via `railway run`, no dotenv):
 *   node scripts/create-task-repeat-index.js           # dry run: says what it would do
 *   node scripts/create-task-repeat-index.js --apply   # build it
 * Then: npm run audit-index-drift
 *
 * Rollback: db.stafftasks.dropIndex('staff_task_repeat_of') — only after the
 * repeat code is rolled back too, or a double "done" could make two copies.
 */
import mongoose from 'mongoose';
import StaffTask from '../models/StaffTask.js';

const APPLY = process.argv.includes('--apply');
const TAG = '[task-repeat-index]';

export const INDEXES = [
  [{ repeatOf: 1 }, { unique: true, partialFilterExpression: { repeatOf: { $type: 'objectId' } }, name: 'staff_task_repeat_of' }],
];

export async function buildIndexes({ apply = APPLY, log = console.log } = {}) {
  const coll = StaffTask.collection;
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
