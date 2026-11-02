/**
 * Fill in `assignees` and `teams` on staff tasks made before Tasks phase 4.
 *
 * WHY
 * ---
 * Phase 4 lets one task have several people. The new fields (models/StaffTask.js
 * `assignees`, `teams`) are written beside the old `assignee` / `team` on every
 * create and change from the moment the phase-4a code is live, but tasks made
 * before that have only the old fields. Once every task has the new ones, the
 * lists can read them (phase 4b) without missing anything.
 *
 * WHAT IT DOES
 * ------------
 * For each task WITHOUT `assignees`: `assignees = [{ user: assignee, name: assigneeName }]`
 * and `teams = [team]` — the same one person, nothing else changes. Old tasks that
 * were given to several people stay separate copies (the owner's decision,
 * 2026-11-02): each copy simply gets its own one person.
 *
 * Each write is one pipeline update filtered on `assignees` still missing, so it
 * copies the values the document holds AT THAT MOMENT and never overwrites a task
 * the live code has already written. Running it twice changes nothing the second time.
 *
 * ORDER: deploy the phase-4a code FIRST (so new and changed tasks carry the fields),
 * then run this. Running it first would let tasks made in between go without.
 *
 * Usage (on the server, so the host's MONGODB_URI applies):
 *   railway run node scripts/backfill-task-assignees.js           # dry run, writes nothing
 *   railway run node scripts/backfill-task-assignees.js --apply   # fill them in
 *
 * ROLLBACK — only BEFORE phase 4b is live (after that the lists read these fields):
 *   db.stafftasks.updateMany({}, { $unset: { assignees: 1, teams: 1 } })
 * The old `assignee` / `team` fields are never touched, so the phase-4a code keeps
 * working either way.
 */

import mongoose from 'mongoose';
import { pathToFileURL } from 'url';

const COLLECTION = 'stafftasks';
const BATCH = 500;

/** Tasks still without the new fields. `$exists: false`, not `null`: an empty list is a written value. */
export const MISSING = Object.freeze({ assignees: { $exists: false } });

/** The new fields, built by the database from the task's own `assignee` / `team`. */
export const FILL = Object.freeze([
  {
    $set: {
      assignees: [{ user: '$assignee', name: { $ifNull: ['$assigneeName', ''] } }],
      teams: [{ $ifNull: ['$team', null] }],
    },
  },
]);

/**
 * Count what is missing and, with `apply`, fill it in. Pure database work, so the
 * tests run it against an in-memory MongoDB.
 *
 * @param {import('mongodb').Db} db
 * @returns {Promise<{ total: number, missing: number, filled: number, left: number, mismatched: number, sample: object[] }>}
 */
export async function backfill(db, { apply = false, batch = BATCH, log = () => {} } = {}) {
  const tasks = db.collection(COLLECTION);
  const total = await tasks.countDocuments({});
  const missing = await tasks.countDocuments(MISSING);
  const sample = await tasks
    .find(MISSING, { projection: { number: 1, assignee: 1, assigneeName: 1, team: 1 } })
    .limit(5)
    .toArray();

  let filled = 0;
  if (apply) {
    // Batches by _id: progress shows, and no single write holds the whole collection.
    let after = null;
    for (;;) {
      const ids = (await tasks
        .find({ ...MISSING, ...(after ? { _id: { $gt: after } } : {}) }, { projection: { _id: 1 } })
        .sort({ _id: 1 })
        .limit(batch)
        .toArray()).map((d) => d._id);
      if (!ids.length) break;
      const res = await tasks.updateMany({ _id: { $in: ids }, ...MISSING }, FILL);
      filled += res.modifiedCount;
      after = ids[ids.length - 1];
      log(`  filled ${filled} / ${missing}`);
    }
  }

  const left = await tasks.countDocuments(MISSING);
  // Every task with the new fields must name the same first person as `assignee`.
  const mismatched = await tasks.countDocuments({
    assignees: { $exists: true },
    $expr: { $ne: [{ $arrayElemAt: ['$assignees.user', 0] }, '$assignee'] },
  });
  return { total, missing, filled, left, mismatched, sample };
}

const uriHost = (u) => String(u || '')
  .replace(/^mongodb(\+srv)?:\/\//, '')
  .replace(/^.*@/, '') // credentials are never printed
  .split(/[/?]/)[0] || '(unknown)';

async function main() {
  const apply = process.argv.slice(2).includes('--apply');
  const { MONGODB_URI, MONGO_URI } = process.env;
  if (MONGODB_URI && MONGO_URI && uriHost(MONGODB_URI) !== uriHost(MONGO_URI)) {
    console.error('✋ ABORT: MONGODB_URI and MONGO_URI point at different clusters. Unset one and run again.');
    process.exit(1);
  }
  const uri = MONGODB_URI || MONGO_URI;
  if (!uri) {
    console.error('✋ ABORT: set MONGODB_URI (railway run node scripts/backfill-task-assignees.js).');
    process.exit(1);
  }
  // autoIndex:false — this may point at production; a bare connect() would build
  // every declared index there.
  await mongoose.connect(uri, { autoIndex: false });
  const { db } = mongoose.connection;
  console.log('BACKFILL TASK ASSIGNEES');
  console.log(`mode     : ${apply ? '*** APPLY (writing) ***' : 'DRY RUN (no writes)'}`);
  console.log(`cluster  : ${uriHost(uri)}`);
  console.log(`database : ${db.databaseName}`);

  const r = await backfill(db, { apply, log: (line) => console.log(line) });
  console.log(`tasks    : ${r.total}`);
  console.log(`missing  : ${r.missing}${apply ? '' : '  (would be filled)'}`);
  for (const t of r.sample) {
    console.log(`  e.g. T-${t.number} → [${t.assigneeName || t.assignee}] team ${t.team ?? 'admin'}`);
  }
  if (apply) console.log(`filled   : ${r.filled}`);
  console.log(`left     : ${r.left}`);
  console.log(`mismatch : ${r.mismatched}  (tasks whose first person is not their assignee — must be 0)`);
  console.log('rollback (only before phase 4b is live): db.stafftasks.updateMany({}, { $unset: { assignees: 1, teams: 1 } })');
  await mongoose.disconnect();
  if (apply && (r.left > 0 || r.mismatched > 0)) process.exit(2);
}

// Only when run as a command: importing it in a test must never connect anywhere.
const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) {
  main().catch((err) => { console.error('[backfill-task-assignees] fatal:', err); process.exit(1); });
}
